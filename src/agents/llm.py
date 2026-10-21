"""Optional Gemini client. Disabled unless GEMINI_API_KEY and LLM_FAST_MODEL are set.

Returns provider-reported token counts (measured), never estimates presented as measured.
"""
import logging
import time

log = logging.getLogger(__name__)
_client = None


def generate(prompt: str, system: str, max_tokens: int = 400, model: str | None = None, json: bool = False):
    """-> (text | None, usage dict). None means disabled or failed; callers must fall back."""
    global _client
    from config.settings import get_settings
    from core.usage import record
    s = get_settings()
    model = model or s.llm_fast_model
    if not s.llm_enabled:
        return None, None
    t = time.perf_counter()
    try:
        from google import genai
        from google.genai import types
        _client = _client or genai.Client(api_key=s.gemini_api_key.get_secret_value(),
                                          http_options=types.HttpOptions(timeout=int(s.llm_timeout_s * 1000)))  # ms
        r = _client.models.generate_content(
            model=model, contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system, temperature=0.2, max_output_tokens=max_tokens,
                                               response_mime_type="application/json" if json else None))
        um = r.usage_metadata
        return r.text, record("llm", 1000 * (time.perf_counter() - t), model,
                              um.prompt_token_count or 0, um.candidates_token_count or 0, measured=True)
    except Exception as e:
        log.warning("LLM call failed: %s", type(e).__name__)
        return None, record("llm", 1000 * (time.perf_counter() - t), model, error=type(e).__name__)
