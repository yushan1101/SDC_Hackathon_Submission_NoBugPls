from governance.audit import connect
from governance.employee_ids import allocate_ids


def test_analysis_ids_skip_existing_employees_and_survive_restart(tmp_path):
    path = str(tmp_path / "employees.sqlite")
    con = connect(path)
    with con:
        con.execute("INSERT INTO plans VALUES('old', 'E-008', 'hr', '2026-01-01')")
    assert allocate_ids(con, ["E-001", "E-002"], ["E-010"]) == ["E-011", "E-012"]
    with con:
        con.execute("DELETE FROM plans")
    con.close()
    con = connect(path)
    assert allocate_ids(con, ["E-001", "E-002"], []) == ["E-013", "E-014"]
    con.close()


def test_oversized_ids_are_ignored_and_accounts_cannot_take_analysis_ids():
    import pytest
    from governance import accounts, approval

    con = connect(":memory:")
    with con:
        con.execute("INSERT INTO analysis_employee_ids VALUES(9223372036854775807)")
    assert allocate_ids(con, ["E-99999999999999999999"], []) == ["E-001"]
    approval.create(con, {"status": "draft"}, "HR-ONLY", "hr")
    for taken in ["E-001", "HR-ONLY"]:
        with pytest.raises(accounts.AuthError, match="already used"):
            accounts.create_user(con, "late_hire", "Password123", "employee", taken)
    accounts.create_user(con, "late_hire", "Password123", "employee", "E-002")
