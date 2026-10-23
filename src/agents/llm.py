"""LLM client for the agents. Each agent has its own model, chosen in .env (never in code):

    ROUTER_MODEL=gemini:gemini-3.1-flash-lite     COACH_MODEL=openai:grok-4.7     RESUME_MODEL=openai:gpt-5.6-luna

"openai:<model>" calls any OpenAI-compatible /chat/completions endpoint at LLM_BASE_URL with LLM_API_KEY;
"gemini:<model>" (or a bare model id) uses Google's client with GEMINI_API_KEY. Unset or failing -> None, and every
caller falls back to its deterministic path. Returns provider-reported token counts (measured), never estimates.

An HR advisor can choose the model per task for their organisation (from the admin's allowed list). The API sets
ORG_MODELS for each request ({task: spec}); model_for() prefers that choice when its provider is configured.
"""
import contextvars
import logging
import re
import time

log = logging.getLogger(__name__)
_gemini = None
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


def api_base(url: str) -> str:
    """A bare host ("https://gw.example") gets the standard "/v1"; a URL that already has a path is used as given."""
    from urllib.parse import urlparse
    url = url.rstrip("/")
    return url + "/v1" if urlparse(url).path in ("", "/") else url


def _openai(model: str, prompt: str, system: str, max_tokens: int, json: bool, s):
    import httpx
    body = {"model": model, "temperature": 0.2, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    if json:
        body["response_format"] = {"type": "json_object"}
    for attempt in (1, 2):  # one retry, only for transient failures (timeout / gateway 5xx)
        try:
            r = httpx.post(api_base(s.llm_base_url) + "/chat/completions", json=body, timeout=s.llm_timeout_s,
                           headers={"Authorization": f"Bearer {s.llm_api_key.get_secret_value()}"})
            if r.status_code < 500 or attempt == 2:
                break
        except httpx.TimeoutException:
            if attempt == 2:
                raise
        time.sleep(1.5)
    r.raise_for_status()
    d = r.json()
    u = d.get("usage") or {}
    return d["choices"][0]["message"]["content"], u.get("prompt_tokens", 0), u.get("completion_tokens", 0)


def _gemini_call(model: str, prompt: str, system: str, max_tokens: int, json: bool, s):
    global _gemini
    from google import genai
    from google.genai import types
    _gemini = _gemini or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                      http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))  # ms
    r = _gemini.models.generate_content(model=model, contents=prompt, config=types.GenerateContentConfig(
        system_instruction=system, temperature=0.2, max_output_tokens=max_tokens,
        response_mime_type="application/json" if json else None))
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


def generate(prompt: str, system: str, max_tokens: int = 400, model: str | None = None, json: bool = False,
             agent: str = "router"):
    """-> (text | None, usage dict). None means disabled or failed; callers must fall back."""
    from config.settings import get_settings
    from core.usage import record
    s = get_settings()
    spec = model or model_for(agent)
    if not spec:
        return None, None
    provider, name = spec.split(":", 1) if ":" in spec else ("gemini", spec)
    t = time.perf_counter()
    try:
        text, tin, tout = (_openai if provider == "openai" else _gemini_call)(name, prompt, system, max_tokens, json, s)
        return text, record("llm", 1000 * (time.perf_counter() - t), name, tin, tout, measured=True)
    except Exception as e:
        log.warning("LLM call failed (%s %s): %s", provider, name, type(e).__name__)
        return None, record("llm", 1000 * (time.perf_counter() - t), name, error=type(e).__name__)


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
