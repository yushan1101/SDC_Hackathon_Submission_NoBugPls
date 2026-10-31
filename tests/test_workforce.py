"""Heatmap data sources: HR team uploads stay separate from employees' individual analyses."""
import json
import sqlite3

from governance import workforce


def _db():
    con = sqlite3.connect(":memory:")
    con.executescript("""CREATE TABLE users(username TEXT, role TEXT, employee_id TEXT, status TEXT, invited_by TEXT);
        CREATE TABLE plans(plan_id TEXT, subject_id TEXT, audience TEXT, created_utc TEXT);
        CREATE TABLE plan_reports(plan_id TEXT, report TEXT);
        CREATE TABLE plan_versions(plan_id TEXT, version INTEGER, snapshot TEXT);
        CREATE TABLE plan_references(plan_id TEXT, number INTEGER);
        CREATE TABLE hr_reviews(plan_id TEXT, deleted_utc TEXT, archived INTEGER);""")
    con.executemany("INSERT INTO users VALUES(?,?,?,?,?)", [("ann", "employee", "E-001", "active", "hr1"),
                                                            ("bob", "employee", "E-002", "active", "hr2")])
    gap = {"skill_id": "SQL", "current_level": 1, "required_level": 3}

    def plan(pid, subject, audience, owner=None):
        report = {"gaps": [gap], "request": {"scenario": "assistive"}, "occupation": {"title": "Data analyst"}}
        if owner:
            report["workforce"] = {"owner": owner}
        con.execute("INSERT INTO plans VALUES(?,?,?,?)", (pid, subject, audience, pid))
        con.execute("INSERT INTO plan_reports VALUES(?,?)", (pid, json.dumps(report)))
        con.execute("INSERT INTO plan_versions VALUES(?,?,?)", (pid, 1, json.dumps({"scenario": "assistive"})))
    plan("p1", "E-001", "individual")          # hr1's employee, own resume analysis
    plan("p2", "E-002", "individual")          # someone else's employee
    plan("p3", "E-001", "hr", owner="hr1")     # hr1's upload; id collides with ann's account id
    plan("p4", "X-9", "hr", owner="hr2")       # another HR's upload
    plan("p5", "X-7", "hr")                    # older upload with no owner tag
    return con


def test_heatmap_uses_team_uploads_and_excludes_individual_analyses():
    recs = workforce.load_reports(_db(), "hr1", "assistive")
    assert sorted((r["key"], r["source"]) for r in recs) == [("upload:E-001", "hr_upload"), ("upload:X-7", "hr_upload")]
    data = workforce.aggregate(recs)
    assert data["overview"]["employees"] == 2 and {s["key"]: s["employees"] for s in data["sources"]} == {"hr_upload": 2, "external": 0}
    assert workforce.aggregate(recs, source="employee")["overview"]["employees"] == 0
    assert [g["kind"] for g in data["groups"]] == ["role"]  # no departments recorded, so roles are compared


def test_scenario_switch_keeps_uploaded_employees_and_uses_comparison_targets():
    con = _db()
    for pid, subject, current in (("a1", "A1", 2), ("a2", "A2", 3)):
        report = {"gaps": [{"skill_id": "SQL", "current_level": current, "required_level": 3,
                            "assessed": True}],
                  "comparison": [{"skill_id": "SQL", "assistive_required": 3, "agentic_required": 4}],
                  "request": {"scenario": "assistive"}, "occupation": {"title": "Data analyst"},
                  "workforce": {"owner": "hr1", "dataset": "Analytics"}}
        con.execute("INSERT INTO plans VALUES(?,?,?,?)", (pid, subject, "hr", pid))
        con.execute("INSERT INTO plan_reports VALUES(?,?)", (pid, json.dumps(report)))
        con.execute("INSERT INTO plan_versions VALUES(?,?,?)", (pid, 1, json.dumps({"scenario": "assistive"})))
    assistive = workforce.aggregate(workforce.load_reports(con, "hr1", "assistive"), datasets=["Analytics"])
    agentic = workforce.aggregate(workforce.load_reports(con, "hr1", "agentic"), datasets=["Analytics"])
    assert assistive["overview"]["employees"] == agentic["overview"]["employees"] == 2
    assert assistive["cells"][0]["affected"] == 1
    assert agentic["cells"][0]["affected"] == 2
    assert assistive["cells"][0]["required"] == 3
    assert agentic["cells"][0]["required"] == 4
    assert not agentic["policy"]["sample_preview"]
    assert agentic["scenario_impact"]["changed_skills"] == 1
    assert agentic["scenario_impact"]["new_gaps"] == 1
    assert agentic["scenario_impact"]["employees_with_target_changes"] == 2


def test_scenario_target_can_change_without_changing_gap_counts():
    record = {"key": "A1", "role": "Data analyst", "report": {
        "gaps": [{"skill_id": "Handle data samples", "current_level": 4, "required_level": 3, "assessed": True}],
        "comparison": [{"skill_id": "Handle data samples", "assistive_required": 3, "agentic_required": 2}]},
        "scenario": "agentic"}
    result = workforce.aggregate([record])
    assert result["overview"]["employees"] == 1
    assert result["cells"][0]["affected"] == 0
    assert result["scenario_impact"]["changed_skills"] == 1
    assert result["scenario_impact"]["lower_targets"] == 1
    assert result["scenario_impact"]["new_gaps"] == result["scenario_impact"]["closed_gaps"] == 0
    assert result["rows"][0]["scenario_change"]["agentic_target"] == 2


def test_uploads_are_named_data_sets_and_external_groups_compare_side_by_side():
    con = _db()
    gap = lambda cur: {"skill_id": "SQL", "current_level": cur, "required_level": 3}

    def upload(pid, subject, dataset, batch, external=False, department=None, group=None, cur=1):
        meta = {"owner": "hr1", "dataset": dataset, "dataset_id": batch, "external": external,
                **({"department": department} if department else {}), **({"group": group} if group else {})}
        report = {"gaps": [gap(cur)], "request": {"scenario": "assistive"}, "occupation": {"title": "Data analyst"}, "workforce": meta}
        con.execute("INSERT INTO plans VALUES(?,?,?,?)", (pid, subject, "hr", pid))
        con.execute("INSERT INTO plan_reports VALUES(?,?)", (pid, json.dumps(report)))
        con.execute("INSERT INTO plan_versions VALUES(?,?,?)", (pid, 1, json.dumps({"scenario": "assistive"})))
    upload("q1", "A1", "ICU nurses", "b1", department="ICU", cur=1)
    upload("q2", "A2", "ICU nurses", "b1", department="ICU", cur=3)
    upload("q3", "A1", "Partner clinic", "b2", external=True, group="Penang", cur=1)  # same id, another upload: another person
    upload("q4", "A3", "Partner clinic", "b2", external=True, group="Penang", cur=1)
    recs = workforce.load_reports(con, "hr1", "assistive")
    by_set = workforce.aggregate(recs, group_by="dataset")
    assert [g["label"] for g in by_set["groups"]] == ["Earlier uploads", "ICU nurses", "Partner clinic"]
    cells = {c["group"]: c for c in by_set["cells"] if c["skill"] == "SQL"}
    assert cells["ICU nurses"]["gap_percent"] == 50 and cells["Partner clinic"]["gap_percent"] == 100
    sets = {d["name"]: d for d in by_set["options"]["datasets"]}
    assert sets["Partner clinic"]["external"] and sets["Partner clinic"]["people"] == 2 and not sets["ICU nurses"]["external"]
    only = workforce.aggregate(recs, datasets=["Partner clinic"], group_by="group")
    assert [g["label"] for g in only["groups"]] == ["Penang"] and only["overview"]["employees"] == 2
    ext = workforce.aggregate(recs, source="external")
    assert ext["cohort"]["employees"] == 2 and {s["key"]: s["employees"] for s in ext["sources"]}["external"] == 2
    assert [g["label"] for g in workforce.aggregate(recs, group_by="source")["groups"]] == ["External groups", "Team uploads"]


def test_other_hr_exports_are_read_without_guessing():
    import pandas as pd
    from core.team_import import normalize_team
    wide = pd.DataFrame({"Staff ID": ["A1", "A2"], "Job Title": ["nurse", "nurse"], "Dept": ["ER", "ICU"],
                         "Communication": [80, 40], "Critical thinking": [60, None]})
    long, meta, notes = normalize_team(wide, 100)
    assert sorted(zip(long["employee_id"], long["skill"], long["level"])) == [("A1", "communication", 4), ("A1", "critical thinking", 3), ("A2", "communication", 2)]
    assert meta == {"A1": {"department": "ER"}, "A2": {"department": "ICU"}} and any("0-100" in n for n in notes)
    assert normalize_team(wide, 7)[2] == ["level scale must be one of [5, 10, 100]"]  # HR states the scale; it is never guessed
