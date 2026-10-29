"""Scenario behavior with exact skill matches, independent of embeddings or live trend data."""
import numpy as np
import pytest

from agents import gap_analyst, matcher


@pytest.fixture
def occupations(monkeypatch):
    names = ["Judge results", "Process records", "Python"]
    roles = {
        "judgement": {"title": "Reviewer", "skills": {
            names[0]: {"required": 2, "importance": 5, "agentic": 1}}, "tech": []},
        "routine": {"title": "Processor", "skills": {
            names[1]: {"required": 3, "importance": 5, "agentic": -1}}, "tech": []},
        "mixed": {"title": "Coordinator", "skills": {
            names[0]: {"required": 2, "importance": 5, "agentic": 1},
            names[1]: {"required": 3, "importance": 3, "agentic": -1},
            names[2]: {"required": 2, "importance": 2, "agentic": 1}}, "tech": [{"name": "Python"}]},
        "neutral": {"title": "Neutral", "skills": {
            names[0]: {"required": 2, "importance": 5, "agentic": 0}}, "tech": []},
        "automated": {"title": "Routine beginner", "skills": {
            names[1]: {"required": 1, "importance": 5, "agentic": -1}}, "tech": []},
    }
    monkeypatch.setattr(matcher, "snapshot", lambda: {"occupations": roles})
    monkeypatch.setattr(matcher, "vocabulary", lambda: (names, np.eye(3)))
    monkeypatch.setattr(matcher, "vectors", lambda keys: np.array([np.eye(3)[names.index(k)] for k in keys]))
    matcher._occ_index.cache_clear()
    matcher._scenario_requirements.cache_clear()
    yield roles
    matcher._occ_index.cache_clear()
    matcher._scenario_requirements.cache_clear()


def test_scenario_changes_fit_ranking_gaps_and_advice_without_trends(occupations):
    from agents.resume import role_advice
    levels = {"Judge results": 2, "Process records": 2, "Python": 2}
    before = levels.copy()
    assistive = matcher.match_roles(levels, 10, scenario="assistive")
    agentic = matcher.match_roles(levels, 10, scenario="agentic")
    a = {m["soc"]: m for m in assistive}
    g = {m["soc"]: m for m in agentic}
    assert a["judgement"]["fit"] > a["routine"]["fit"]
    assert g["judgement"]["fit"] < g["routine"]["fit"]
    assert [m["soc"] for m in assistive].index("judgement") < [m["soc"] for m in assistive].index("routine")
    assert [m["soc"] for m in agentic].index("routine") < [m["soc"] for m in agentic].index("judgement")
    assert a["mixed"]["top_gaps"] == ["Process records"]
    assert g["mixed"]["top_gaps"] == ["Judge results"]
    assert a["mixed"]["fit"] != g["mixed"]["fit"]
    assert a["mixed"]["trend_effect"] == g["mixed"]["trend_effect"] == 0
    assert role_advice([a["mixed"]])[0]["skills"] == ["Process records"]
    assert role_advice([g["mixed"]])[0]["skills"] == ["Judge results"]
    assert "agentic AI" in role_advice([g["mixed"]])[0]["why"]
    assert levels == before
    assert matcher.match_roles(levels, 10, scenario="assistive") == assistive  # cached base untouched


def test_matching_requirements_agree_with_plans_and_leave_tools_unchanged(occupations):
    o = occupations["mixed"]
    reqs = {name: {**d, "kind": "tool" if name == "Python" else "skill", "evidence_id": "test"}
            for name, d in o["skills"].items()}
    gaps = gap_analyst.analyze({}, reqs, "agentic")
    actual = dict(zip(o["skills"], matcher._scenario_requirements("agentic")["mixed"]))
    assert actual == {g.skill_id: g.required_level for g in gaps}
    assert actual == {"Judge results": 3, "Process records": 2, "Python": 2}
    a = matcher.match_roles({"Judge results": 2}, 10)
    g = matcher.match_roles({"Judge results": 2}, 10, scenario="agentic")
    neutral = lambda rows: next(m for m in rows if m["soc"] == "neutral")
    assert neutral(a)["fit"] == neutral(g)["fit"]
    assert neutral(g)["requirement_changes"] == []
    automated = next(m for m in g if m["soc"] == "automated")
    assert automated["gap_levels"] == 0 and automated["top_gaps"] == []
    assert np.isfinite(automated["fit"])


def test_trends_still_change_ranking_independently_of_fit(occupations):
    levels = {"Judge results": 2, "Process records": 2, "Python": 2}
    baseline = {r["soc"]: r for r in matcher.match_roles(levels, 10)}
    board = {"occupations": {"judgement": {"emergence": 1.2, "pressure": 0.4}}}
    updated = {r["soc"]: r for r in matcher.match_roles(levels, 10, board=board)}
    assert updated["judgement"]["fit"] == baseline["judgement"]["fit"]
    assert updated["judgement"]["score"] > baseline["judgement"]["score"]
