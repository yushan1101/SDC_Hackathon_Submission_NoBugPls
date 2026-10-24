import json
import os

import pytest

from governance import approval, reviews
from governance.audit import connect
from governance.employee_ids import allocate_ids

HR = {"username": "hr", "role": "hr_advisor"}
EMPLOYEE = {"username": "employee", "role": "employee", "employee_id": "E1"}
PLAN = {"status": "draft", "target_role": "Analyst", "activities": []}


sqlite_only = pytest.mark.skipif(bool(os.environ.get("TEST_DATABASE_URL")), reason="upgrades an existing SQLite file")


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


@sqlite_only
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
    con.close()


def test_ids_can_be_reused_after_deletion_or_rename_and_persist(tmp_path):
    path = str(tmp_path / "reused.sqlite")
    con = connect(path)
    old = approval.create(con, PLAN, "E-001", "hr")
    pid = approval.create(con, PLAN, "E-002", "hr")
    old_reference = approval.reference(con, old)
    reviews.bulk(con, [old], HR, "delete", True)
    # Historical generation reservations must not block manual edits.
    with con:
        con.execute("INSERT INTO analysis_employee_ids VALUES(1)")
    reviews.edit(con, pid, HR, {"employee_id": "E-001", "plan_reference": old_reference, "review_status": "pending"}, 0)
    assert approval.list_plans(con, HR)[0]["subject_id"] == "E-001"
    assert approval.latest(con, pid)["plan_reference"] == old_reference
    assert reviews.history(con, pid)[0]["before"]["plan_reference"] == "P000002"
    third = approval.create(con, PLAN, "E-003", "hr")
    # Editing away from an ID frees it for another current plan.
    reviews.edit(con, pid, HR, {"employee_id": "E-004", "plan_reference": "P000004", "review_status": "pending"}, 1)
    reviews.edit(con, third, HR, {"employee_id": "E-001", "plan_reference": old_reference, "review_status": "pending"}, 0)
    # Automatic generation skips a current manually assigned plan ID.
    fourth = approval.create(con, PLAN, "E-005", "hr")
    assert approval.reference(con, fourth) == "P000005"
    con.close()
    con = connect(path)
    assert approval.reference(con, pid) == "P000004"
    assert approval.reference(con, third) == old_reference
    con.close()


def test_duplicate_id_edits_are_atomic_and_unchanged_ids_are_allowed():
    con = connect(":memory:")
    first = approval.create(con, PLAN, "E-001", "hr")
    second = approval.create(con, PLAN, "E-002", "hr")
    # Archived plans remain current; only deleted plans release their IDs.
    reviews.bulk(con, [first], HR, "archive")
    for changes, message in [
        ({"employee_id": "E-001"}, "Employee ID is already used"),
        ({"employee_id": "E-003", "plan_reference": "P000001"}, "Plan ID is already used"),
        ({"plan_reference": "PLAN-000003"}, "six digits"),
    ]:
        with pytest.raises(approval.TransitionError, match=message):
            reviews.edit(con, second, HR, changes | {"review_status": "pending"}, 0)
        assert reviews.history(con, second) == []
        assert con.execute("SELECT subject_id FROM plans WHERE plan_id=?", (second,)).fetchone()[0] == "E-002"
        assert approval.reference(con, second) == "P000002"
    reviews.edit(con, second, HR, {"employee_id": "E-002", "plan_reference": "P000002", "review_status": "pending"}, 0)
    assert reviews.get(con, second)["revision"] == 1
    con.close()


def test_employee_accounts_can_receive_plans_without_revealing_private_plans():
    from governance import accounts
    con = connect(":memory:")
    accounts.create_user(con, "worker", "Password123", "employee", "U-worker")
    approval.create(con, PLAN, "U-worker", "individual")  # the employee's private self-service plan
    first, second = approval.create(con, PLAN, "E-001", "hr"), approval.create(con, PLAN, "E-002", "hr")
    reviews.edit(con, first, HR, {"employee_id": "U-worker", "review_status": "pending"}, 0)
    reviews.edit(con, second, HR, {"employee_id": "U-worker", "review_status": "pending"}, 0)
    with pytest.raises(approval.TransitionError, match="9 digits"):
        reviews.edit(con, first, HR, {"employee_id": "E-9223372036854775807", "review_status": "pending"}, 1)
    reviews.edit(con, first, HR, {"employee_id": "E-123456789", "review_status": "pending"}, 1)
    assert allocate_ids(con, ["x"], []) == ["E-123456790"]
