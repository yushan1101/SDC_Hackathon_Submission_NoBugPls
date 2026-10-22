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
