import pytest

from governance import accounts, approval
from governance.audit import connect

PW = "Correct-Horse9"


def db():
    con = accounts.init(connect(":memory:"))
    accounts.create_user(con, "ana", PW, "employee", "E-001")
    accounts.create_user(con, "hr1", PW, "hr_advisor")
    return con


def test_password_policy_and_hashing():
    con = db()
    with pytest.raises(accounts.AuthError):
        accounts.create_user(con, "bob", "short", "employee", "E-2")
    with pytest.raises(accounts.AuthError):
        accounts.create_user(con, "bob", PW, "employee")  # employee needs pseudonymous id
    row = con.execute("SELECT pw_hash FROM users WHERE username='ana'").fetchone()[0]
    assert PW.encode() not in row
    assert accounts.authenticate(con, "ANA", PW)["employee_id"] == "E-001"


def test_lockout_after_failures():
    con = db()
    for _ in range(3):
        with pytest.raises(accounts.AuthError):
            accounts.authenticate(con, "ana", "wrong", max_failures=3)
    with pytest.raises(accounts.AuthError, match="locked"):
        accounts.authenticate(con, "ana", PW, max_failures=3)


def test_hr_cannot_see_private_plans_employee_sees_hr_plans():
    con = db()
    ana = accounts.authenticate(con, "ana", PW)
    hr = accounts.authenticate(con, "hr1", PW)
    private = approval.create(con, {"target_role": "Data Analyst", "status": "draft"}, "E-001", "individual")
    shared = approval.create(con, {"target_role": "Data Analyst", "status": "draft"}, "E-001", "hr")
    other = approval.create(con, {"target_role": "Data Analyst", "status": "draft"}, "E-999", "hr")
    assert not approval.can_act(con, private, hr)
    assert {p["plan_id"] for p in approval.list_plans(con, hr)} == {shared, other}
    assert {p["plan_id"] for p in approval.list_plans(con, ana)} == {private, shared}
    assert not approval.can_act(con, other, ana)
    approval.approve(con, shared, 1, "hr1", "hr_advisor", True)
    approval.acknowledge(con, shared, ana)
    assert approval.history(con, shared)[-1]["action"] == "acknowledged"
