"""Cheap-LLM resume skill proposals: redacted input only, verbatim quotes only, rules keep levels and labels."""
import json

import pytest

from agents import llm, resume

MD = """# Jane Doe
jane.doe@example.com | +1 555 0100
## Experience
Senior data analyst, 6 years. She built dashboards in Tableau for the finance team.
Automated monthly reporting with Python scripts and SQL queries.
"""


@pytest.fixture
def llm_on(monkeypatch):
    from config.settings import get_settings
    monkeypatch.setenv("LLM_RESUME", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def fake(reply, seen):
    def gen(prompt, system, max_tokens=400, model=None, json=False, agent="router", timeout=None, reasoning=None):
        seen.append(prompt)
        return reply, {"node": "llm", "measured": True, "prompt_tokens": 100, "completion_tokens": 20}
    return gen


def test_llm_sees_redacted_resume_and_only_verbatim_quotes_survive(llm_on, monkeypatch):
    seen = []
    reply = json.dumps({"skills": [
        {"skill": "data visualisation", "quote": "built dashboards in   Tableau"},  # real (whitespace differs)
        {"skill": "machine learning", "quote": "Led ML research at Google"},  # hallucinated quote
        {"skill": "SQL", "quote": "SQL queries", "level": 5}]})               # level from the LLM is ignored
    monkeypatch.setattr(llm, "generate", fake(reply, seen))
    x = resume.extract(MD)
    x["skills"] = resume.verify(MD, x["skills"])
    assert "Jane" not in seen[0] and "jane.doe@example.com" not in seen[0]
    assert x["extraction_mode"] == "rules+llm" and x["llm_usage"]["measured"]
    quotes = [q for s in x["skills"] for q in s["evidence"]]
    assert not any("Google" in q for q in quotes)
    assert all(s["level"] <= 4 for s in x["skills"] if s["source"] == "llm")
    assert "Deliver visual presentation of data" in {s["name"] for s in x["skills"] if s["source"] == "llm"}


def test_malformed_or_disabled_llm_keeps_rules_result(llm_on, monkeypatch):
    monkeypatch.setattr(llm, "generate", fake("not json {", []))
    x = resume.extract(MD)
    assert x["extraction_mode"] == "rules" and all(s["source"] == "rules" for s in x["skills"])
    monkeypatch.setattr(llm, "generate", fake(None, []))  # key missing / call failed
    assert resume.extract(MD)["extraction_mode"] == "rules"


def test_llm_off_by_default_makes_no_call(monkeypatch):
    seen = []
    monkeypatch.setattr(llm, "generate", fake("{}", seen))
    assert resume.extract(MD)["extraction_mode"] == "rules" and seen == []


def test_a_call_over_its_time_budget_gives_up_on_time(monkeypatch):
    """The résumé page waits on these calls: a slow model must not hold it past the budget (the rules then stand)."""
    import time
    monkeypatch.setattr(llm, "_gemini_call", lambda *a: (time.sleep(3), ("late", 1, 1))[1])
    t = time.perf_counter()
    text, usage = llm.generate("p", "s", model="gemini:any", timeout=0.5)
    assert text is None and usage["error"] == "TimeoutError" and time.perf_counter() - t < 1.5
