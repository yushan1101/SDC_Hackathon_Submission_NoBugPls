import json

import pytest

from governance import approval, reviews
from governance.audit import connect

HR = {"username": "hr", "role": "hr_advisor"}
EMPLOYEE = {"username": "employee", "role": "employee", "employee_id": "E1"}
PLAN = {"status": "draft", "target_role": "Analyst", "activities": []}


def seed(con, audience="hr"):
    pid = approval.create(con, PLAN, "E1", audience)
    with con:
        con.execute("INSERT INTO plan_reports VALUES(?,?)", (pid, json.dumps({"narrative": "Original AI", "evidence": ["source"]})))
    return pid


def test_edit_lifecycle_persists_and_preserves_ai(tmp_path):
    path = str(tmp_path / "reviews.sqlite")
    con = connect(path)
    pid = seed(con)
    versions = con.execute("SELECT * FROM plan_versions").fetchall()
    report = con.execute("SELECT * FROM plan_reports").fetchall()
    approval_history = approval.history(con, pid)
    changed = reviews.edit(con, pid, HR, {"candidate_name": "Candidate", "reviewer_notes": "Human notes", "review_status": "rejected"}, 0)
    assert changed["revision"] == 1
    with pytest.raises(approval.TransitionError, match="changed"):
        reviews.edit(con, pid, HR, {"review_status": "approved"}, 0)
    reviews.bulk(con, [pid], HR, "archive")
    assert reviews.get(con, pid)["archived"]
    reviews.bulk(con, [pid], HR, "restore")
    assert not reviews.get(con, pid)["archived"]
    assert reviews.get(con, pid)["review_status"] == "rejected"
    with pytest.raises(approval.TransitionError, match="confirmation"):
        reviews.bulk(con, [pid], HR, "delete")
    reviews.bulk(con, [pid], HR, "delete", True)
    con.close()
    con = connect(path)
    assert reviews.get(con, pid)["deleted_utc"]
    assert reviews.get(con, pid)["candidate_name"] == "Candidate"
    assert not approval.can_act(con, pid, HR)
    assert not approval.can_act(con, pid, EMPLOYEE)
    assert approval.list_plans(con, HR) == []
    assert con.execute("SELECT * FROM plan_versions").fetchall() == versions
    assert con.execute("SELECT * FROM plan_reports").fetchall() == report
    assert approval.history(con, pid) == approval_history
    trail = reviews.history(con, pid)
    assert [e["action"] for e in trail] == ["edited", "archive", "restore", "delete"]
    assert trail[0]["before"]["review_status"] == "pending"
    assert trail[0]["after"]["reviewer_notes"] == "Human notes"
    with pytest.raises(Exception, match="immutable"):
        con.execute("UPDATE hr_review_events SET actor='fake'")
    con.close()


def test_bulk_authorization_and_atomicity():
    con = connect(":memory:")
    pid, private = seed(con), seed(con, "individual")
    for user, ids in [(EMPLOYEE, [pid]), (HR, [pid, private]), (HR, [pid, "missing"])]:
        with pytest.raises(approval.TransitionError):
            reviews.bulk(con, ids, user, "archive")
        assert not reviews.get(con, pid)["archived"]
        assert reviews.history(con, pid) == []
    with pytest.raises(approval.TransitionError):
        reviews.edit(con, private, HR, {"review_status": "approved"}, 0)
    with pytest.raises(approval.TransitionError):
        reviews.edit(con, pid, HR, {"review_status": "approved", "subject_id": "other"}, 0)
    assert reviews.bulk(con, [pid, pid], HR, "archive") == [pid]


def test_existing_database_migration_and_approval_default(tmp_path):
    import sqlite3
    path = str(tmp_path / "old.sqlite")
    legacy = sqlite3.connect(path)
    legacy.execute("CREATE TABLE plans(plan_id TEXT PRIMARY KEY, subject_id TEXT, audience TEXT, created_utc TEXT)")
    legacy.commit()
    legacy.close()
    con = connect(path)
    pid = seed(con)
    approval.approve(con, pid, 1, "hr", "hr_advisor", True)
    assert reviews.get(con, pid)["review_status"] == "approved"
    con.close()
    con = connect(path)
    assert reviews.get(con, pid)["review_status"] == "approved"
