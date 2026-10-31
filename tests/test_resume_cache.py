"""Résumé results by file hash: the same file (same model, same thinking setting) replays the saved result, no second AI
read; a run that fell back to the rules is not kept. The cache uses Redis when REDIS_URL is set."""
import pytest

from core import cache


@pytest.fixture
def fresh(monkeypatch):
    from server import api
    cache._local.clear()
    calls = []

    def fake(filename, data, progress, thinking):
        calls.append(thinking)
        return {"skills": [{"name": "SQL", "level": 3}], "llm_usage": {"error": ""}, "insight": {"usage": {"error": ""}}}
    monkeypatch.setattr(api, "_analyze_resume_fresh", fake)
    monkeypatch.setattr(api, "RESUME_REPLAY_S", 0)
    return api, calls


def test_same_file_replays_the_saved_result(fresh):
    api, calls = fresh
    stages = []
    first = api._analyze_resume("a.pdf", b"same bytes", stages.append, False)
    again = api._analyze_resume("renamed.pdf", b"same bytes", stages.append, False)
    assert first["cached"] is False and again["cached"] is True and calls == [False]
    assert stages == list(api.RESUME_STAGES)  # the replay walks the stages, so the page shows progress
    api._analyze_resume("a.pdf", b"same bytes", lambda s: None, True)  # thinking on is its own entry
    api._analyze_resume("a.pdf", b"other bytes", lambda s: None, False)
    assert calls == [False, True, False]


def test_a_run_that_fell_back_to_rules_is_not_kept(fresh, monkeypatch):
    api, calls = fresh
    monkeypatch.setattr(api, "_analyze_resume_fresh", lambda *a: calls.append(1) or
                        {"skills": [], "llm_usage": {"error": "TimeoutError"}, "insight": {}})
    api._analyze_resume("a.pdf", b"x", lambda s: None, False)
    assert api._analyze_resume("a.pdf", b"x", lambda s: None, False)["cached"] is False and len(calls) == 2


def test_cache_uses_redis_when_configured(monkeypatch):
    store = {}

    class FakeRedis:
        def get(self, k): return store.get(k)
        def set(self, k, v, ex=None): store[k] = v

    monkeypatch.setattr(cache, "_client", FakeRedis())
    from config.settings import get_settings
    monkeypatch.setattr(get_settings(), "redis_url", "redis://example:6379/0", raising=False)
    cache.set("k", {"a": 1})
    assert "k" in store and "k" not in cache._local and cache.get("k") == {"a": 1}


def test_thinking_off_asks_the_gateway_model_to_skip_its_reasoning(monkeypatch):
    import httpx
    from agents import llm
    sent = []

    class R:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "{}"}}], "usage": {}}
    monkeypatch.setattr(httpx, "post", lambda url, json, **k: sent.append(json) or R())
    from config.settings import get_settings
    s = get_settings()
    llm._openai("grok-4.7", "p", "s", 10, True, s, reasoning=False)
    llm._openai("grok-4.7", "p", "s", 10, True, s)
    assert sent[0]["reasoning"] == {"enabled": False, "effort": "none"} and sent[0]["reasoning_effort"] == "none"
    assert "reasoning" not in sent[1] and "reasoning_effort" not in sent[1]


def test_speech_falls_back_and_reports_status(monkeypatch):
    """Pocket TTS failing -> the fallback cloud voice; the transcription model failing -> the fast Gemini model.
    Either way /api/health shows the model in use and the last error type."""
    from agents import llm
    monkeypatch.setattr(llm, "tts_model", lambda: "gemini:gemini-3.1-flash-tts-preview")  # a server .env naming another voice
    monkeypatch.setattr(llm, "stt_model", lambda: "openai:mimo")
    monkeypatch.setattr(llm, "usable", lambda spec: True)
    monkeypatch.setattr(llm, "providers", lambda: {"openai": True, "gemini": True})
    tried = []
    monkeypatch.setattr(llm, "_speak_with", lambda spec, text: tried.append(spec) or ((b"RIFF", {"model": spec}) if "2.5-flash" in spec  # only the fallback works, as on the server
                        else (None, {"error": "RuntimeError"})))
    monkeypatch.setattr(llm, "_transcribe_with", lambda spec, *a: ("hello", {}) if spec.startswith("gemini:")
                        else (None, {"error": "HTTPStatusError"}))
    audio, usage = llm.speak("Hi.")
    assert tried[0] == "pocket:pocket-tts"  # Pocket TTS is always tried first, even when TTS_MODEL names another voice
    assert tried[1] == "gemini:gemini-3.1-flash-tts-preview" and len(tried) == 3  # then TTS_MODEL, then the fallback
    assert audio == b"RIFF" and usage["model"].startswith("gemini:") and llm.SPEECH_STATUS["tts"]["ok"] is True
    text, _ = llm.transcribe(b"x", "audio/wav")
    assert text == "hello" and llm.SPEECH_STATUS["stt"]["model"].startswith("gemini:")


def test_a_failing_text_model_falls_back_once_within_the_budget(monkeypatch):
    from agents import llm
    from config.settings import get_settings
    monkeypatch.setattr(get_settings(), "llm_fallback_model", "openai:deepseek-v4.1-flash", raising=False)
    monkeypatch.setattr(llm, "usable", lambda spec: True)
    tried = []
    monkeypatch.setattr(llm, "_generate_with", lambda spec, *a: tried.append(spec) or
                        ((None, {"error": "ServerError"}) if spec.startswith("gemini:") else ("{}", {"model": spec})))
    assert llm.generate("p", "s", model="gemini:gemini-3.1-flash-lite")[0] == "{}"
    assert tried == ["gemini:gemini-3.1-flash-lite", "openai:deepseek-v4.1-flash"]
    tried.clear()  # no time left in the caller's budget: no second try
    assert llm.generate("p", "s", model="gemini:gemini-3.1-flash-lite", timeout=1.0)[0] is None and len(tried) == 1


def test_an_unreadable_ai_reply_gets_one_more_try_before_the_candidate_sees_an_error(monkeypatch):
    from interview import service
    calls = []

    def flaky(*a):
        calls.append(1)
        if len(calls) == 1:
            raise service.InterviewError("The AI returned an incomplete evaluation. Please retry.", 502)
        return {"scores": {}}, {"text": "Next?"}, 1, False
    monkeypatch.setattr(service, "evaluate_and_choose", flaky)
    out = service.prepare_answer({"status": "in_progress"}, {}, "answer", [])
    assert len(calls) == 2 and out["next_question"]["text"] == "Next?"


def test_transcription_is_english_and_a_filler_only_result_counts_as_nothing(monkeypatch):
    from agents import llm
    assert "English" in llm._stt_prompt("en-US") and "English" in llm._stt_prompt("")
    monkeypatch.setattr(llm, "stt_model", lambda: "openai:mimo")
    monkeypatch.setattr(llm, "providers", lambda: {"openai": True, "gemini": False})
    for heard, kept in [("嗯", ""), ("嗯。", ""), ("Um...", ""), ("Um, I led a team.", "Um, I led a team.")]:
        monkeypatch.setattr(llm, "_transcribe_with", lambda *a, heard=heard: (heard, {}))
        assert llm.transcribe(b"x", "audio/wav", "en-US")[0] == kept


def test_a_slow_or_failing_model_is_raced_by_the_backups_and_the_first_answer_wins(monkeypatch):
    import time
    from agents import llm
    from config.settings import get_settings
    monkeypatch.setattr(get_settings(), "llm_fallback_model", "openai:qwen,openai:grok-fast", raising=False)
    monkeypatch.setattr(llm, "usable", lambda spec: True)

    def fake(spec, *a):
        if spec == "gemini:flash-lite":
            time.sleep(3); return "late", {"model": spec}  # overloaded: answers, but too slowly
        if spec == "openai:qwen":
            return None, {"error": "ReadTimeout"}  # a backup that fails does not stop the others
        time.sleep(0.2); return "{}", {"model": spec}
    monkeypatch.setattr(llm, "_generate_with", fake)
    t = time.perf_counter()
    text, usage = llm.generate("p", "s", model="gemini:flash-lite", timeout=10, hedge_s=0.5)
    assert text == "{}" and usage["model"] == "openai:grok-fast" and time.perf_counter() - t < 2
