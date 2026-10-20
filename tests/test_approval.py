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
