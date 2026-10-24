"""governance/db.py on Postgres: no_wait() relaxes only its own transaction (Postgres CI job only)."""
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Postgres runs only")


def test_no_wait_applies_to_one_transaction_only(tmp_path):
    from governance import db
    con = db.connect(str(tmp_path / "nowait.sqlite3"))
    con.executescript("CREATE TABLE IF NOT EXISTS t(k TEXT PRIMARY KEY, v INTEGER)")
    default = con.execute("SHOW synchronous_commit").fetchone()[0]
    con.execute("INSERT INTO t VALUES('a', 1)")
    db.no_wait(con)
    assert con.execute("SHOW synchronous_commit").fetchone()[0] == "local"
    con.commit()
    assert con.execute("SHOW synchronous_commit").fetchone()[0] == default  # next transaction waits again
    db.no_wait(con)  # outside a transaction: nothing to relax
    assert con.execute("SHOW synchronous_commit").fetchone()[0] == default
    assert con.execute("SELECT v FROM t WHERE k='a'").fetchone() == (1,)
