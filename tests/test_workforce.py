"""Heatmap data sources: an HR advisor sees their invited employees' own analyses and their own team uploads."""
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


def test_heatmap_uses_own_employees_and_own_uploads():
    recs = workforce.load_reports(_db(), "hr1", "assistive")
    assert sorted((r["key"], r["source"]) for r in recs) == [("E-001", "employee"), ("upload:E-001", "hr_upload"), ("upload:X-7", "hr_upload")]
    data = workforce.aggregate(recs, source="employee")
    assert data["overview"]["employees"] == 1 and {s["key"]: s["employees"] for s in data["sources"]} == {"employee": 1, "hr_upload": 2}
    assert [g["kind"] for g in data["groups"]] == ["role"]  # no departments recorded, so roles are compared
