"""Per-agent model routing (agents/llm.py) and the résumé advice guard (agents/resume.advise)."""
import json

import pytest

from agents import llm, resume
from config.settings import get_settings


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://gateway.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("COACH_MODEL", "openai:grok-4.7")
    monkeypatch.setenv("RESUME_MODEL", "openai:gpt-5.6-luna")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_each_agent_uses_its_own_model_on_the_shared_gateway(gateway, monkeypatch):
    calls = []

    class Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}

    def post(url, json=None, headers=None, timeout=None):
        calls.append((url, json["model"], headers["Authorization"]))
        return Resp()
    import httpx
    monkeypatch.setattr(httpx, "post", post)
    for agent in ("coach", "resume"):
        text, usage = llm.generate("hi", "sys", agent=agent)
        assert text == "ok" and usage["tokens_measured"] and usage["input_tokens"] == 12 and usage["model"] in ("grok-4.7", "gpt-5.6-luna")
    assert [c[1] for c in calls] == ["grok-4.7", "gpt-5.6-luna"]
    assert all(c[0] == "https://gateway.test/v1/chat/completions" and c[2] == "Bearer test-key" for c in calls)


def test_unconfigured_gateway_falls_back_then_turns_off(monkeypatch):
    monkeypatch.setenv("COACH_MODEL", "openai:grok-4.7")  # no LLM_BASE_URL / key
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    monkeypatch.setenv("LLM_FAST_MODEL", "gemini-3.1-flash-lite")
    get_settings.cache_clear()
    assert llm.model_for("coach") == "gemini:gemini-3.1-flash-lite"
    monkeypatch.setenv("GEMINI_API_KEY", "")
    get_settings.cache_clear()
    assert llm.model_for("coach") == "" and llm.generate("hi", "sys", agent="coach") == (None, None)
    get_settings.cache_clear()


MD = "# Sam\nBuilt dashboards in Tableau for finance.\nAutomated reporting with Python scripts.\n"
SKILLS = [{"name": "Python (computer programming)", "level": 3, "evidence": ["Automated reporting with Python scripts."]},
          {"name": "Deliver visual presentation of data", "level": 2, "evidence": ["Built dashboards in Tableau for finance."]}]
MATCHES = [{"title": "Data analyst", "soc": "2511.2", "fit": 0.42, "top_gaps": ["Perform data analysis", "Use databases"]}]


def test_rule_advice_always_works():
    ins = resume.advise(MD, SKILLS, MATCHES, 3)
    assert ins["mode"] == "rules" and "2 skills found" in ins["headline"]
    assert ins["advice"][0]["role"] == "Data analyst" and "Perform data analysis" in ins["advice"][0]["action"]
    assert ins["strengths"][0]["quote"] in MD


def test_llm_advice_cannot_invent_roles_skills_or_quotes(monkeypatch):
    monkeypatch.setenv("LLM_RESUME", "true")
    get_settings.cache_clear()
    reply = {"headline": "Analytical builder of reporting tools.",
             "strengths": [{"skill": "Python (computer programming)", "quote": "Automated reporting with Python scripts"},
                           {"skill": "Python (computer programming)", "quote": "Led a team of 40 at Google"}],
             "advice": [{"action": "Learn SQL databases", "why": "Data analyst roles need it", "role": "Data analyst", "skills": ["Use databases"]},
                        {"action": "Become a CTO", "why": "prestige", "role": "Chief technology officer", "skills": []},
                        {"action": "Get certified in quantum origami", "why": "?", "role": None, "skills": ["Quantum origami"]}]}
    monkeypatch.setattr(llm, "generate", lambda *a, **k: (json.dumps(reply), {"measured": True}))
    ins = resume.advise(MD, SKILLS, MATCHES, 3)
    assert ins["mode"] == "rules+llm" and ins["headline"].startswith("Analytical")
    assert [s["quote"] for s in ins["strengths"]] == ["Automated reporting with Python scripts"]
    assert [a["action"] for a in ins["advice"]] == ["Learn SQL databases"] and ins["advice"][0]["soc"] == "2511.2"
    get_settings.cache_clear()


def test_voice_goes_to_the_audio_chat_model_as_input_audio(gateway, monkeypatch):
    """mimo-v2.6-flash hears audio through /chat/completions; this gateway returns its answer in reasoning_content."""
    import httpx
    monkeypatch.setenv("STT_MODEL", "openai:mimo-v2.6-flash")
    get_settings.cache_clear()
    sent = {}

    class Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "", "reasoning_content": "six hours a week"}}],
                                "usage": {"prompt_tokens": 54, "completion_tokens": 19}}

    def post(url, json=None, headers=None, timeout=None, **k):
        sent.update(url=url, body=json)
        return Resp()
    monkeypatch.setattr(httpx, "post", post)
    text, usage = llm.transcribe(b"RIFF....WAVE", "audio/wav", "en")
    assert text == "six hours a week" and usage["model"] == "mimo-v2.6-flash"
    part = sent["body"]["messages"][0]["content"][1]
    assert sent["url"].endswith("/chat/completions") and part["type"] == "input_audio" and part["input_audio"]["format"] == "wav"
    assert llm.transcribe(b"webm", "audio/webm", "en")[0] is None  # not a format the model takes: the browser sends WAV
