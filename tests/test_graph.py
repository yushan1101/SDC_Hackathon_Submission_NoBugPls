from core.graph import run, run_team
from core.state import Profile, Request, Skill

NURSE = "29-1141.00"


def req(query="Analyze my skill gaps and create a 30-60-90 day plan", scenario="assistive", hours=6,
        role=NURSE, skills=(("communication", 3), ("critical thinking", 2)), **kw):
    return Request(request_id="t", profile=Profile(skills=[Skill(name=n, level=l) for n, l in skills],
                                                   weekly_learning_hours=hours),
                   target_role=role, scenario=scenario, query=query, **kw)


def nodes(s):
    return [u["node"] for u in s["usage"]]


def test_unsupported_skips_pipeline():  # T-01
    s = run(req("write a poem"))
    assert s["route"] == "unsupported" and "profiler" not in nodes(s)


def test_simple_lookup():  # T-02
    s = run(req("what is critical thinking"))
    assert s["route"] == "simple" and s["evidence"] and "gap_analysis" not in nodes(s)


def test_complex_draft_with_real_evidence():  # T-03
    s = run(req())
    assert s["route"] == "complex" and s["status"] in ("draft", "flagged")
    ids = {e.id for e in s["evidence"]}
    assert all(e in ids for a in s["draft_pathway"].activities for e in a.evidence_ids)
    ct = next(g for g in s["skill_gaps"] if g.skill_id == "Critical Thinking")  # "critical thinking" normalised
    assert ct.current_level == 2 and ct.gap == max(0, ct.required_level - 2)
    sp = next(g for g in s["skill_gaps"] if g.skill_id == "Speaking")  # "communication" alias
    assert sp.current_level == 3


def test_scenarios_differ():  # T-04
    a = {g.skill_id: g.required_level for g in run(req())["skill_gaps"]}
    b = {g.skill_id: g.required_level for g in run(req(scenario="agentic"))["skill_gaps"]}
    assert a != b and b["Critical Thinking"] == min(5, a["Critical Thinking"] + 1)


def test_works_for_any_occupation():
    for role in ("Electricians", "13-2011.00", "Customer Service Representatives"):
        s = run(req(role=role, skills=(("excel", 2), ("mathematics", 3))))
        assert s["status"] in ("draft", "flagged") and s["skill_gaps"] and s["narrative"]
        assert not any(i.code == "no_evidence" for i in s["validation_issues"])


def test_unknown_occupation_flags_instead_of_inventing():
    s = run(req(role="Astronaut chef of Mars"))
    assert s["status"] == "flagged" and any(i.code == "no_evidence" for i in s["validation_issues"])


def test_low_hours_defers_not_overbooks():  # T-09
    s = run(req(hours=1))
    assert s["draft_pathway"].deferred_skills
    assert any(i.code == "deferred" for i in s["validation_issues"])


def test_hr_team_view_aggregates():
    t = run_team([req(audience="hr", employee_id=f"E{i}") for i in range(3)])
    assert set(t["employees"]) == {"E0", "E1", "E2"}
    assert t["team_skill_needs"][0]["employees_with_gap"] == 3
