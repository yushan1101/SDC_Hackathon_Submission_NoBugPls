from core.graph import run, run_team
from core.state import Profile, Request, Skill


def req(query="Analyze my skill gaps and create a 30-60-90 day plan", scenario="assistive", hours=6, **kw):
    return Request(request_id="t", profile=Profile(skills=[Skill(name="Python", level=3), Skill(name="SQL", level=2)],
                                                   weekly_learning_hours=hours),
                   target_role="Data Analyst", scenario=scenario, query=query, **kw)


def nodes(s):
    return [u["node"] for u in s["usage"]]


def test_unsupported_skips_pipeline():  # T-01
    s = run(req("write a poem"))
    assert s["route"] == "unsupported" and "profiler" not in nodes(s)


def test_simple_lookup():  # T-02
    s = run(req("what is SQL"))
    assert s["route"] == "simple" and s["evidence"] and "gap_analysis" not in nodes(s)


def test_complex_draft_with_real_evidence():  # T-03
    s = run(req())
    assert s["route"] == "complex" and s["status"] in ("draft", "flagged")
    ids = {e.id for e in s["evidence"]}
    assert all(e in ids for a in s["draft_pathway"].activities for e in a.evidence_ids)
    sql = next(g for g in s["skill_gaps"] if g.skill_id == "sql")
    assert sql.gap == max(0, sql.required_level - 2)


def test_scenarios_differ():  # T-04
    a = {g.skill_id: g.required_level for g in run(req())["skill_gaps"]}
    b = {g.skill_id: g.required_level for g in run(req(scenario="agentic"))["skill_gaps"]}
    assert a != b and b["python"] == a["python"] + 1 and b["excel"] == a["excel"] - 1


def test_low_hours_defers_not_overbooks():  # T-09
    s = run(req(hours=1))
    assert s["draft_pathway"].deferred_skills
    assert any(i.code == "deferred" for i in s["validation_issues"])
    assert s["draft_pathway"].status == "draft"


def test_hr_team_view_aggregates():
    t = run_team([req(audience="hr", employee_id=f"E{i}") for i in range(3)])
    assert set(t["employees"]) == {"E0", "E1", "E2"}
    assert t["team_skill_needs"][0]["employees_with_gap"] == 3
