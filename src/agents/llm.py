"""LLM client for the agents. Each agent has its own model, chosen in .env (never in code):

    ROUTER_MODEL=gemini:gemini-3.1-flash-lite     COACH_MODEL=openai:grok-4.7     RESUME_MODEL=openai:gpt-5.6-luna

"openai:<model>" calls any OpenAI-compatible /chat/completions endpoint at LLM_BASE_URL with LLM_API_KEY;
"gemini:<model>" (or a bare model id) uses Google's client with GEMINI_API_KEY. Unset or failing -> None, and every
caller falls back to its deterministic path. Returns provider-reported token counts (measured), never estimates.
"""
import logging
import time

log = logging.getLogger(__name__)
_gemini = None


def model_for(agent: str) -> str:
    """'provider:model' for an agent, or '' when no usable model is configured."""
    from config.settings import get_settings
    s = get_settings()
    gateway = bool(s.llm_base_url and s.llm_api_key and s.llm_api_key.get_secret_value())
    gemini = bool(s.gemini_api_key and s.gemini_api_key.get_secret_value())
    fallback = f"gemini:{s.llm_fast_model}" if s.llm_fast_model and gemini else ""
    spec = getattr(s, f"{agent}_model", "")
    if not spec:
        return fallback
    spec = spec if ":" in spec else f"gemini:{spec}"
    usable = gateway if spec.startswith("openai:") else gemini
    return spec if usable else fallback  # gateway not set up yet -> keep working on Gemini, else deterministic


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
