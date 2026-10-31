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
