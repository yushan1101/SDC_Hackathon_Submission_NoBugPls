"""LLM client for the agents. Each agent has its own model, chosen in .env (never in code):

    ROUTER_MODEL=gemini:gemini-3.1-flash-lite     COACH_MODEL=openai:grok-4.7     RESUME_MODEL=openai:gpt-5.6-luna

"openai:<model>" calls any OpenAI-compatible /chat/completions endpoint at LLM_BASE_URL with LLM_API_KEY;
"gemini:<model>" (or a bare model id) uses Google's client with GEMINI_API_KEY. Unset or failing -> None, and every
caller falls back to its deterministic path. Returns provider-reported token counts (measured), never estimates.

An HR advisor can choose the model per task for their organisation (from the admin's allowed list). The API sets
ORG_MODELS for each request ({task: spec}); model_for() prefers that choice when its provider is configured.
"""
import contextvars
import io
import logging
import re
import threading
import time
import wave

log = logging.getLogger(__name__)
_gemini = None
_pocket = None  # (TTSModel, {voice: state}) once loaded: Kyutai Pocket TTS, ~100M params, faster than real time on CPU
_pocket_lock = threading.Lock()
ORG_MODELS: contextvars.ContextVar = contextvars.ContextVar("org_models", default=None)
# tasks an HR advisor can choose a model for -> what they cover
TASKS = {"coach": "Career coach chat and interview feedback", "resume": "Reading and screening resumes",
         "recruiter": "Job posts, team questions and voice job drafts"}


def providers() -> dict:
    from config.settings import get_settings
    s = get_settings()
    return {"openai": bool(s.llm_base_url and s.llm_api_key and s.llm_api_key.get_secret_value()),
            "gemini": bool(s.gemini_api_key and s.gemini_api_key.get_secret_value())}


def usable(spec: str) -> bool:
    if spec.startswith("pocket:"):  # runs in this process: usable when the package is installed
        import importlib.util
        return importlib.util.find_spec("pocket_tts") is not None
    return bool(spec) and providers()["openai" if spec.startswith("openai:") else "gemini"]


def model_for(agent: str, org: bool = True) -> str:
    """'provider:model' for an agent, or '' when no usable model is configured. org=False: ignore the organisation's
    choice (the admin default)."""
    from config.settings import get_settings
    s = get_settings()
    chosen = (ORG_MODELS.get() or {}).get(agent) if org else None
    if chosen and usable(chosen):
        return chosen
    fallback = f"gemini:{s.llm_fast_model}" if s.llm_fast_model and providers()["gemini"] else ""
    spec = getattr(s, f"{agent}_model", "")
    if not spec:
        return fallback
    spec = spec if ":" in spec else f"gemini:{spec}"
    return spec if usable(spec) else fallback  # gateway not set up yet -> keep working on Gemini, else deterministic


_gateway_cache: tuple[float, list] = (0.0, [])


def gateway_models(refresh: bool = False) -> list[str]:
    """Model ids the OpenAI-compatible gateway offers (GET {LLM_BASE_URL}/v1/models), cached a minute; [] if unset or down."""
    global _gateway_cache
    if not providers()["openai"]:
        return []
    if not refresh and time.monotonic() - _gateway_cache[0] < 60:
        return _gateway_cache[1]
    import httpx
    from config.settings import get_settings
    s = get_settings()
    try:
        r = httpx.get(api_base(s.llm_base_url) + "/models", timeout=15,
                      headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"})
        r.raise_for_status()
        ids = sorted({str(m.get("id")) for m in (r.json().get("data") or []) if m.get("id")})
    except Exception as e:  # noqa: BLE001 - a gateway outage must not break the admin page
        log.warning("gateway /models failed: %s", e)
        return []
    _gateway_cache = (time.monotonic(), ids)
    return ids


def api_base(url: str) -> str:
    """A bare host ("https://gw.example") gets the standard "/v1"; a URL that already has a path is used as given."""
    from urllib.parse import urlparse
    url = url.rstrip("/")
    return url + "/v1" if urlparse(url).path in ("", "/") else url


def _openai(model: str, prompt: str, system: str, max_tokens: int, json: bool, s, timeout: float | None = None,
            reasoning: bool | None = None):
    import httpx
    body = {"model": model, "temperature": 0.2, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    if json:
        body["response_format"] = {"type": "json_object"}
    if reasoning is False:  # "thinking off": on the gateway grok-4.7 then reasons ~300-500 tokens instead of ~1100 (~9 s vs ~17 s);
        body["reasoning"] = {"enabled": False, "effort": "none"}  # the two forms together; either alone saves far less
        body["reasoning_effort"] = "none"
    attempts = (1,) if timeout else (1, 2)  # a caller with a time budget gets no retry: it falls back instead
    for attempt in attempts:  # one retry, only for transient failures (timeout / gateway 5xx)
        try:
            r = httpx.post(api_base(s.llm_base_url) + "/chat/completions", json=body, timeout=timeout or s.llm_timeout_s,
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"})
            if r.status_code < 500 or attempt == attempts[-1]:
                break
        except httpx.TimeoutException:
            if attempt == attempts[-1]:
                raise
        time.sleep(1.5)
    r.raise_for_status()
    d = r.json()
    u = d.get("usage") or {}
    return d["choices"][0]["message"]["content"], u.get("prompt_tokens", 0), u.get("completion_tokens", 0)


def _gemini_call(model: str, prompt: str, system: str, max_tokens: int, json: bool, s, timeout: float | None = None,
                 reasoning: bool | None = None):  # noqa: ARG001 - the fast Gemini model does not think by default
    global _gemini
    from google import genai
    from google.genai import types
    _gemini = _gemini or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                      http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))  # ms
    config = types.GenerateContentConfig(
        system_instruction=system, temperature=0.2, max_output_tokens=max_tokens,
        response_mime_type="application/json" if json else None,
        # Gemini refuses deadlines under 10 s; generate() enforces a shorter budget itself by not waiting longer
        http_options=types.HttpOptions(timeout=int(max(timeout, 10) * 1000)) if timeout else None)
    try:
        r = _gemini.models.generate_content(model=model, contents=prompt, config=config)
    except Exception as e:  # a momentary rate limit (429): one quick retry; a budgeted caller still stops waiting on time
        if getattr(e, "code", None) != 429:
            raise
        time.sleep(0.6)
        r = _gemini.models.generate_content(model=model, contents=prompt, config=config)
    um = r.usage_metadata
    return r.text, um.prompt_token_count or 0, um.candidates_token_count or 0


def warm():
    """Import and connect the Gemini client ahead of the first request (the import alone takes seconds)."""
    global _gemini
    from config.settings import get_settings
    s = get_settings()
    if not providers()["gemini"]:
        return
    try:
        from google import genai
        from google.genai import types
        _gemini = _gemini or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                          http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))
    except Exception as e:
        log.warning("model client warm-up failed: %s", type(e).__name__)


_pool = None


def _budget_pool():
    """Threads for model calls with a time budget, so the caller can stop waiting without killing the request."""
    global _pool
    if _pool is None:
        from concurrent.futures import ThreadPoolExecutor
        _pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-budget")
    return _pool


def generate(prompt: str, system: str, max_tokens: int = 400, model: str | None = None, json: bool = False,
             agent: str = "router", timeout: float | None = None, reasoning: bool | None = None):
    """-> (text | None, usage dict). None means disabled or failed; callers must fall back. timeout: a hard limit in
    seconds for a caller someone is waiting on (no retry); past it the call fails and the caller's fallback is used.
    reasoning=False asks a thinking model to (mostly) skip its thinking; None leaves the model's default."""
    from config.settings import get_settings
    from core.usage import record
    s = get_settings()
    spec = model or model_for(agent)
    if not spec:
        return None, None
    provider, name = spec.split(":", 1) if ":" in spec else ("gemini", spec)
    t = time.perf_counter()
    call = lambda: (_openai if provider == "openai" else _gemini_call)(name, prompt, system, max_tokens, json, s, timeout, reasoning)
    try:
        # with a budget, stop waiting when it runs out (the request finishes in the background and is dropped)
        text, tin, tout = _budget_pool().submit(contextvars.copy_context().run, call).result(timeout) if timeout else call()
        return text, record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, measured=True)
    except Exception as e:
        log.warning("LLM call failed (%s %s): %s %s", provider, name, type(e).__name__, getattr(e, "code", "") or "")
        return None, record("llm", 1000 * (time.perf_counter() - t), name, error=type(e).__name__)


def generate_stream(prompt: str, system: str, max_tokens: int = 400, agent: str = "router"):
    """Like generate(), but yields the answer as it is written: {"delta": text} pieces, then one {"usage": ...}.
    An OpenAI-compatible model streams token by token; any other provider (or a failed stream before any text)
    falls back to generate() and yields its whole answer as one piece."""
    import json as _json
    import httpx
    from config.settings import get_settings
    from core.usage import record
    s = get_settings()
    spec = model_for(agent)
    if not spec or not spec.startswith("openai:"):
        text, usage = generate(prompt, system, max_tokens=max_tokens, agent=agent)
        if text:
            yield {"delta": text}
        yield {"usage": usage}
        return
    name = spec.split(":", 1)[1]
    body = {"model": name, "temperature": 0.4, "max_tokens": max_tokens, "stream": True, "stream_options": {"include_usage": True},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    t, tin, tout, sent = time.perf_counter(), 0, 0, False
    try:
        with httpx.stream("POST", api_base(s.llm_base_url) + "/chat/completions", json=body, timeout=max(s.llm_timeout_s, 90),
                          headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"}) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                chunk = _json.loads(data)
                u = chunk.get("usage") or {}
                tin, tout = u.get("prompt_tokens", tin), u.get("completion_tokens", tout)
                for c in chunk.get("choices") or []:
                    piece = (c.get("delta") or {}).get("content")
                    if piece:
                        sent = True
                        yield {"delta": piece}
    except Exception as e:
        log.warning("LLM stream failed (%s): %s", name, type(e).__name__)
        if not sent:  # nothing shown yet: one ordinary call instead
            text, usage = generate(prompt, system, max_tokens=max_tokens, agent=agent)
            if text:
                yield {"delta": text}
            yield {"usage": usage}
            return
    yield {"usage": record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, measured=True)}


def generate_with_tools(prompt: str, system: str, tools: dict, max_tokens: int = 900, agent: str = "router",
                        rounds: int = 4, on_tool=None):
    """Like generate(), but an OpenAI-compatible model may first call tools: {name: (description, json schema, fn)}.
    Gemini, or a gateway that rejects tools: a plain generate(). -> (text | None, usage)."""
    import json as _json
    import httpx
    from config.settings import get_settings
    from core.usage import record
    s = get_settings()
    spec = model_for(agent)
    if not spec or not spec.startswith("openai:"):
        return generate(prompt, system, max_tokens=max_tokens, agent=agent)
    name = spec.split(":", 1)[1]
    defs = [{"type": "function", "function": {"name": n, "description": d, "parameters": p}} for n, (d, p, _) in tools.items()]
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    t, tin, tout = time.perf_counter(), 0, 0
    try:
        for turn in range(rounds + 1):
            body = {"model": name, "temperature": 0.2, "max_tokens": max_tokens, "messages": msgs}
            if turn < rounds:  # the last round must answer
                body["tools"] = defs
            r = httpx.post(api_base(s.llm_base_url) + "/chat/completions", json=body, timeout=max(s.llm_timeout_s, 60),
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"})
            if r.status_code == 400 and turn == 0:  # this model or gateway has no tool calling
                return generate(prompt, system, max_tokens=max_tokens, agent=agent)
            r.raise_for_status()
            d = r.json()
            u = d.get("usage") or {}
            tin, tout = tin + u.get("prompt_tokens", 0), tout + u.get("completion_tokens", 0)
            m = d["choices"][0]["message"]
            calls = m.get("tool_calls") or []
            if not calls:
                return m.get("content"), record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, measured=True)
            msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
            for c in calls[:6]:
                fn_name, args = c["function"]["name"], {}
                try:
                    args = _json.loads(c["function"].get("arguments") or "{}")
                    out = tools[fn_name][2](**args) if fn_name in tools else {"error": "unknown tool"}
                except Exception as e:  # noqa: BLE001 - a failed tool is reported to the model, which answers without it
                    log.warning("tool %s failed: %s", fn_name, type(e).__name__)
                    out = {"error": f"{type(e).__name__}: the tool failed"}
                if on_tool:
                    on_tool(fn_name, args if isinstance(args, dict) else {})
                msgs.append({"role": "tool", "tool_call_id": c["id"], "content": _json.dumps(out, ensure_ascii=False, default=str)[:8000]})
    except Exception as e:
        log.warning("LLM tool call failed (%s): %s", name, type(e).__name__)
        return None, record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, error=type(e).__name__)
    return None, record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, error="too_many_rounds")


def tts_model() -> str:
    """Text-to-speech model: TTS_MODEL if its provider is set up, else ''."""
    from config.settings import get_settings
    s = get_settings()
    spec = s.tts_model if ":" in s.tts_model or not s.tts_model else f"gemini:{s.tts_model}"
    return spec if spec and usable(spec) else ""


def pocket_warm() -> None:
    """Load Pocket TTS and its voice ahead of the first sentence (~15 s cold, once per process)."""
    global _pocket
    from config.settings import get_settings
    voice = get_settings().pocket_voice
    with _pocket_lock:
        if _pocket is None:
            from pocket_tts import TTSModel
            _pocket = (TTSModel.load_model(), {})
        if voice not in _pocket[1]:
            _pocket[1][voice] = _pocket[0].get_state_for_audio_prompt(voice)


def _pocket_speak(text: str) -> bytes:
    """WAV of `text` in POCKET_VOICE (default "alba": a female voice), from the in-process CPU model."""
    import numpy as np
    from config.settings import get_settings
    pocket_warm()
    with _pocket_lock:  # generation state is not shared between requests
        model, voices = _pocket
        samples = model.generate_audio(voices[get_settings().pocket_voice], text).detach().cpu().numpy()
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(model.sample_rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return out.getvalue()


def speak(text: str):
    """-> (WAV bytes | None, usage): `text` read in the configured server voice."""
    from config.settings import get_settings
    from core.usage import record
    s, spec = get_settings(), tts_model()
    if not spec:
        return None, None
    provider, name = spec.split(":", 1)
    t = time.perf_counter()
    try:
        if provider == "pocket":
            audio = _pocket_speak(text)
        elif provider == "openai":
            import httpx
            r = httpx.post(api_base(s.llm_base_url) + "/audio/speech", timeout=max(s.llm_timeout_s, 60),
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
                           json={"model": name, "input": text, "voice": s.tts_voice, "response_format": "wav"})
            r.raise_for_status()
            audio = r.content
        else:
            global _gemini
            from google import genai
            from google.genai import types
            _gemini = _gemini or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                              http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))
            prompt = f"Say in {s.tts_style}: {text}" if s.tts_style else text  # the style directs, it isn't read out
            r = _gemini.models.generate_content(model=name, contents=prompt, config=types.GenerateContentConfig(
                response_modalities=["AUDIO"], speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=s.tts_voice)))))
            audio = r.candidates[0].content.parts[0].inline_data.data
            if not audio.startswith(b"RIFF"):  # some models send bare 24 kHz 16-bit mono samples: give them a WAV header
                import io
                import wave
                out = io.BytesIO()
                with wave.open(out, "wb") as w:
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(audio)
                audio = out.getvalue()
        return audio, record("tts", 1000 * (time.perf_counter() - t), name, measured=True)
    except Exception as e:
        log.warning("text-to-speech failed (%s %s): %s", provider, name, type(e).__name__)
        return None, record("tts", 1000 * (time.perf_counter() - t), name, error=type(e).__name__)


def stt_model() -> str:
    """Speech-to-text model: STT_MODEL if its provider is set up, else the fast Gemini model (it hears audio), else ''."""
    from config.settings import get_settings
    s = get_settings()
    spec = s.stt_model if ":" in s.stt_model or not s.stt_model else f"gemini:{s.stt_model}"
    if usable(spec):
        return spec
    return f"gemini:{s.llm_fast_model}" if s.llm_fast_model and providers()["gemini"] else ""


AUDIO_FORMATS = {"audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "m4a",
                 "audio/ogg": "ogg", "audio/flac": "flac"}  # what audio chat models take (WebM is not: browsers send WAV)


def transcribe(audio: bytes, mime: str, lang: str = ""):
    """-> (text | None, usage). Words only, no commentary; None when no model is set up or the call failed."""
    from config.settings import get_settings
    from core.usage import record
    s, spec = get_settings(), stt_model()
    if not spec:
        return None, None
    provider, name = spec.split(":", 1)
    t = time.perf_counter()
    try:
        if provider == "openai" and not re.search(r"whisper|transcribe", name):
            # an audio-capable chat model (e.g. mimo-v2.6-flash): the recording goes in as an input_audio part
            import base64
            import httpx
            fmt = AUDIO_FORMATS.get(mime.split(";")[0])
            if not fmt:
                raise ValueError(f"audio format {mime} not accepted by {name}")
            r = httpx.post(api_base(s.llm_base_url) + "/chat/completions", timeout=max(s.llm_timeout_s, 60),
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
                           # MiMo reasons by default and then returns the words as "reasoning"; transcription needs none
                           json={"model": name, "temperature": 0, "max_tokens": 1200,
                                 **({"thinking": {"type": "disabled"}} if "mimo" in name.lower() else {}),
                                 "messages": [{"role": "user", "content": [
                               {"type": "text", "text": "Transcribe this audio exactly, in the language spoken. Reply with only the transcript."},
                               {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio).decode(), "format": fmt}}]}]})
            r.raise_for_status()
            d = r.json()
            m, u = d["choices"][0]["message"], d.get("usage") or {}
            # some gateways put a reasoning model's answer in reasoning_content and leave content empty
            text, tin, tout = m.get("content") or m.get("reasoning_content") or "", u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
        elif provider == "openai":  # a speech-to-text model (whisper-style /audio/transcriptions)
            import httpx
            r = httpx.post(api_base(s.llm_base_url) + "/audio/transcriptions", timeout=max(s.llm_timeout_s, 60),
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"},
                           data={"model": name, **({"language": lang[:2]} if lang else {})},
                           files={"file": ("speech." + (mime.split("/")[-1].split(";")[0] or "webm"), audio, mime)})
            r.raise_for_status()
            text, tin, tout = r.json().get("text", ""), 0, 0
        else:
            global _gemini
            from google import genai
            from google.genai import types
            _gemini = _gemini or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                              http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))
            r = _gemini.models.generate_content(model=name, contents=[
                types.Part.from_bytes(data=audio, mime_type=mime.split(";")[0]),
                "Transcribe this speech exactly, in the language spoken. Return only the words said, no notes."],
                config=types.GenerateContentConfig(temperature=0, max_output_tokens=1200))
            um = r.usage_metadata
            text, tin, tout = r.text or "", um.prompt_token_count or 0, um.candidates_token_count or 0
        return text.strip(), record("stt", 1000 * (time.perf_counter() - t), name, tin, tout, measured=True)
    except Exception as e:
        log.warning("speech-to-text failed (%s %s): %s", provider, name, type(e).__name__)
        return None, record("stt", 1000 * (time.perf_counter() - t), name, error=type(e).__name__)
