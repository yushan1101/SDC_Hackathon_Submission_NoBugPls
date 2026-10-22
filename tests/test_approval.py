import pytest

from governance import approval as ap
from governance.audit import connect

PLAN = {"target_role": "Data Analyst", "activities": [], "status": "draft"}


def test_no_click_stays_draft():  # T-11
    con = connect(":memory:")
    pid = ap.create(con, PLAN, "E1", "hr")
    assert ap.status(con, pid) == "draft"
    with pytest.raises(ap.TransitionError):
        ap.approve(con, pid, 1, "hr-1", "hr_advisor", confirmed=False)
    with pytest.raises(ap.TransitionError):
        ap.approve(con, pid, 1, "", "employee", confirmed=True)


def test_edit_after_approval_new_draft():  # T-12
    con = connect(":memory:")
    pid = ap.create(con, PLAN, "me", "individual")
    v = ap.approve(con, pid, 1, "me", "employee", confirmed=True)
    assert ap.status(con, pid) == "approved"
    v2 = ap.edit(con, pid, PLAN | {"note": "x"}, "me", "employee")
    assert v2 == v + 1 and ap.status(con, pid) == "draft"
    row = con.execute("SELECT status FROM plan_versions WHERE plan_id=? AND version=?", (pid, v)).fetchone()
    assert row[0] == "approved"
    with pytest.raises(Exception):
        con.execute("UPDATE plan_versions SET status='draft' WHERE plan_id=?", (pid,))


def test_flagged_needs_edit_first():
    con = connect(":memory:")
    pid = ap.create(con, PLAN | {"status": "flagged"}, "me", "individual")
    with pytest.raises(ap.TransitionError):
        ap.approve(con, pid, 1, "me", "employee", confirmed=True)


def test_plan_references_are_unique_stable_and_not_reused():
    con = connect(":memory:")
    # These related tables are normally initialised by the API server.
    con.execute("CREATE TABLE interview_sessions(plan_id TEXT)")
    con.execute("CREATE TABLE plan_progress(plan_id TEXT)")
    user = {"username": "me", "employee_id": "me", "role": "employee"}
    first = ap.create(con, PLAN, "me", "individual")
    second = ap.create(con, PLAN, "me", "individual")
    assert ap.reference(con, first) == "PLAN-000001"
    assert ap.reference(con, second) == "PLAN-000002"
    ap.edit(con, first, PLAN, "me", "employee")
    ap.approve(con, first, 2, "me", "employee", confirmed=True)
    assert ap.latest(con, first)["plan_reference"] == "PLAN-000001"
    assert {p["plan_reference"] for p in ap.list_plans(con, user)} == {"PLAN-000001", "PLAN-000002"}
    ap.delete_employee_plans(con, [second], user)
    third = ap.create(con, PLAN, "me", "individual")
    assert ap.reference(con, third) == "PLAN-000003"


def test_existing_plans_receive_persistent_references(tmp_path):
    import sqlite3

    path = str(tmp_path / "legacy.sqlite")
    with sqlite3.connect(path) as legacy:
        legacy.execute("CREATE TABLE plans(plan_id TEXT PRIMARY KEY, subject_id TEXT, audience TEXT, created_utc TEXT)")
        legacy.executemany("INSERT INTO plans VALUES(?,?,?,?)", [
            ("older", "me", "individual", "2026-01-01"),
            ("newer", "me", "individual", "2026-02-01"),
        ])
    con = connect(path)
    assert ap.reference(con, "older") == "PLAN-000001"
    assert ap.reference(con, "newer") == "PLAN-000002"
    con.close()
    con = connect(path)
    assert ap.reference(con, "older") == "PLAN-000001"
    assert ap.reference(con, ap.create(con, PLAN, "me", "individual")) == "PLAN-000003"
    con.close()
