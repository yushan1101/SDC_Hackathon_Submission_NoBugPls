"""Plan diagrams: deterministic, syntactically safe Mermaid / Chart.js output from a ReskillPlan."""
import json
import os
import re
from datetime import date
from pathlib import Path

import pytest

from diagrams import MAX_NODES, ReskillPlan, build, deps, enrich, find_cycle, from_report, label, slug
from diagrams.render import markdown, page

SNAPSHOTS = Path(__file__).resolve().parent / "snapshots"


def plan(skills, hours=6, phases=None, start=date(2026, 1, 5)):
    return ReskillPlan(**{"learner": {"target_role": 'Data "analyst" [junior]', "hours_per_week": hours},
                          "skills": skills, "start_date": start,
                          "phases": phases or [
                              {"id": "p1", "name": "Days 1-30 · Foundation", "start_week": 1, "end_week": 4, "skills": [s["id"] for s in skills[:2]], "milestone": "Clean a dataset: done", "hours": 20},
                              {"id": "p2", "name": "Days 31-60 · Practice", "start_week": 5, "end_week": 8, "skills": [s["id"] for s in skills[1:3]], "milestone": "Dashboard (v1) shipped", "hours": 40},
                              {"id": "p3", "name": "Days 61-90 · Portfolio", "start_week": 9, "end_week": 13, "skills": [s["id"] for s in skills[2:]], "milestone": "Portfolio #1", "hours": 12}],
                          "resources": [{"skill_id": skills[0]["id"], "title": "SQL basics", "type": "course", "est_hours": 4, "url": "https://example.com/sql"}]})


def skill(i, name=None, priority="high", deps=(), category="Data"):
    return {"id": f"s{i}", "name": name or f"Skill {i}", "category": category, "level_now": 1, "level_target": 3,
            "priority": priority, "depends_on": list(deps)}


SMALL = lambda: plan([skill(1, "SQL; joins & [keys]"), skill(2, 'Python "pandas"', deps=["s1"]), skill(3, "Dashboards: Power BI", "medium", ["s2"], "Reporting")])
LARGE = lambda: plan([skill(i, priority="high" if i < 5 else "medium" if i < 10 else "low", deps=[f"s{i - 1}"] if 1 < i < 10 else [],
                            category=["Data", "Reporting", "Tools"][i % 3]) for i in range(1, 41)])
CYCLE = lambda: plan([skill(1, deps=["s3"]), skill(2, deps=["s1"]), skill(3, deps=["s2"])])


def mermaid_ok(code: str) -> None:
    """Structural syntax check (mmdc is not a project dependency): known header, safe ids, balanced quoted labels,
    no raw specials inside labels, edges only between declared nodes."""
    lines = code.splitlines()
    assert lines[0] in ("gantt", "flowchart LR", "mindmap"), lines[0]
    for line in lines[1:]:
        assert "\t" not in line
        for text in re.findall(r'"([^"]*)"', line):
            assert not re.search(r'[\[\]{}()<>|;#`]', text), line
        assert line.count('"') % 2 == 0, line
    if lines[0] == "flowchart LR":
        nodes = set(re.findall(r"^\s+([a-z][a-z0-9_]*)\[", code, re.M))
        for a, b in re.findall(r"^\s+([a-z0-9_]+) --> ([a-z0-9_]+)$", code, re.M):
            assert a in nodes and b in nodes, (a, b)
    if lines[0] == "gantt":
        for line in lines:
            if re.match(r"^\s{4}\S", line):  # task: "<name> :<meta>" with exactly one colon
                assert line.count(":") == 1, line
                assert re.search(r":(milestone, )?[a-z][a-z0-9_]*, \d{4}-\d{2}-\d{2}, \d+d$", line), line
    if lines[0] == "mindmap":
        for line in lines[2:]:
            assert re.match(r"^ {4,6}[a-z][a-z0-9_]*\[[^\[\]()]+\]$", line), line


@pytest.mark.parametrize("make", [SMALL, LARGE])
def test_every_diagram_is_valid(make):
    p = make()
    for d in build(p):
        if d.lang == "mermaid":
            mermaid_ok(d.code)
        else:
            cfg = json.loads(d.code)
            assert cfg["type"] in ("bar", "radar") and cfg["data"]["datasets"]
    assert build(p) == build(p)  # deterministic


def test_labels_and_ids_are_sanitised():
    assert label('a "b" [c] (d) | e; #f') == "a 'b' c d e f"
    taken = set()
    assert slug("3D Printing!", taken) == "s_3d_printing" and slug("3D printing", taken) == "s_3d_printing_2"


def test_circular_dependency_is_reported_not_drawn():
    p = CYCLE()
    assert find_cycle(p.skills) == ["s1", "s3", "s2", "s1"]
    d = deps(p)
    assert d.code == "" and "Circular prerequisite" in d.note
    assert "```mermaid\nflowchart" not in markdown(p, [d])


def test_large_plans_stay_readable():
    p = LARGE()
    d = deps(p)
    assert len(re.findall(r"^\s+[a-z0-9_]+\[", d.code, re.M)) <= MAX_NODES
    assert "low-priority" in d.code
    mm = build(p, ["skillmap"])[0].code
    assert len(re.findall(r"^\s{6}", mm, re.M)) <= MAX_NODES + 3 and "more]" in mm


def test_effort_flags_phases_over_capacity():
    d = build(SMALL(), ["effort"])[0]
    assert json.loads(d.code)["data"]["over"] == [False, True, False]  # 40 h over 30 days > 6 h/week
    assert "Over capacity: Days 31-60" in d.note


def test_timeline_dates_follow_the_plan_weeks():
    code = build(SMALL(), ["timeline"])[0].code
    assert "2026-01-05, 30d" in code and "2026-02-04, 30d" in code and ":milestone, m3, 2026-04-04, 0d" in code


@pytest.mark.parametrize("name,make", [("small", SMALL), ("cycle", CYCLE)])
def test_snapshots(name, make):
    got = "\n\n".join(f"## {d.key}\n{d.note}\n{d.code}" for d in build(make()))
    path = SNAPSHOTS / f"diagrams_{name}.txt"
    if os.environ.get("UPDATE_SNAPSHOTS") or not path.exists():
        path.parent.mkdir(exist_ok=True); path.write_text(got, encoding="utf-8")
    assert got == path.read_text(encoding="utf-8")


def test_enrich_retries_once_then_falls_back():
    p = SMALL().model_copy(update={"skills": [s.model_copy(update={"depends_on": []}) for s in SMALL().skills]})
    answers = iter(['{"skills":[{"id":"nope","category":"X"}]}',
                    '{"skills":[{"id":"s1","category":"databases"},{"id":"s3","category":"bi","depends_on":["s1"]}]}'])
    prompts = []
    got, note = enrich(p, lambda prompt: (prompts.append(prompt), next(answers))[1])
    assert note == "" and "previous answer was invalid" in prompts[1]
    assert [s.category for s in got.skills] == ["Databases", "Data", "Bi"] and got.skills[2].depends_on == ["s1"]
    got, note = enrich(p, lambda prompt: "not json")
    assert got == p and "could not be generated" in note


def test_from_report_uses_only_scheduled_skills():
    report = {"occupation": {"title": "Data analyst"}, "request": {"weekly_learning_hours": 5},
              "gaps": [{"skill_id": "SQL", "current_level": 1, "required_level": 4, "gap": 3},
                       {"skill_id": "Excel", "current_level": 2, "required_level": 4, "gap": 2},
                       {"skill_id": "Python", "current_level": 0, "required_level": 3, "gap": 3}],
              "evidence": [{"id": "e1", "title": "SQL course", "url": "https://example.com/c", "category": "course"}],
              "plan": {"deferred_skills": ["Python"], "activities": [
                  {"day_range": "1-30", "skill_id": "SQL", "activity": "Write joins", "estimated_hours": 10, "evidence_ids": ["e1"], "outcome": "10 queries"},
                  {"day_range": "31-60", "skill_id": "Excel", "activity": "Build a model", "estimated_hours": 8}]}}
    p = from_report(report)
    assert [s.name for s in p.skills] == ["SQL", "Excel"] and p.deferred == ["Python"]
    assert [s.priority for s in p.skills] == ["high", "medium"] and p.phases[0].milestone == "10 queries"
    assert {r.type for r in p.resources} == {"project", "course"}


def test_html_report_is_self_contained_and_pinned():
    html = page(SMALL(), build(SMALL()))
    assert "mermaid@11.4.1" in html and "chart.js@4.4.7" in html
    data = html.split('<script id="data" type="application/json">')[1].split("</script>")[0]
    assert "</" not in data  # plan text cannot close the data script early
    assert json.loads(data.replace("<\\/", "</"))["plan"]["learner"]["target_role"].startswith("Data")
