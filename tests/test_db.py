"""governance/db.py on Postgres: no_wait() and reconnecting after a dropped connection (Postgres CI job only)."""
import os
import sqlite3

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="Postgres runs only")


@pytest.fixture
def con(tmp_path):
    from governance import db
    c = db.connect(str(tmp_path / "reconnect.sqlite3"))
    c.executescript("CREATE TABLE IF NOT EXISTS t(k TEXT PRIMARY KEY, v INTEGER)")
    return c


def kill(con):
    """Drop `con`'s server connection from outside, as a database restart or an idle timeout would."""
    import psycopg
    pid = con.execute("SELECT pg_backend_pid()").fetchone()[0]
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as admin:
        assert admin.execute("SELECT pg_terminate_backend(%s)", (pid,)).fetchone()[0]


def test_read_after_drop_reconnects_into_the_same_schema(con):
    con.execute("INSERT INTO t VALUES('a', 1)"); con.commit()
    kill(con)
    assert con.execute("SELECT v FROM t WHERE k='a'").fetchone() == (1,)  # new connection, same search_path
    assert con.execute("SELECT current_schema()").fetchone()[0] == con.schema


def test_write_after_drop_runs_exactly_once(con):
    kill(con)
    con.execute("INSERT INTO t VALUES('b', 2)"); con.commit()  # retried once on a fresh connection
    assert con.execute("SELECT count(*) FROM t WHERE k='b'").fetchone() == (1,)


def test_drop_mid_transaction_is_reported_not_retried(con):
    con.execute("INSERT INTO t VALUES('c', 3)")  # opens a transaction; not committed
    kill(con)
    with pytest.raises(sqlite3.OperationalError):  # retrying would silently lose the insert above
        con.execute("INSERT INTO t VALUES('d', 4)")
    assert not con.in_transaction
    assert con.execute("SELECT count(*) FROM t WHERE k IN ('c', 'd')").fetchone() == (0,)  # usable again, nothing half-written
    with con:  # and the app's usual `with con:` works on the new connection
        con.execute("INSERT INTO t VALUES('e', 5)")
    assert con.execute("SELECT v FROM t WHERE k='e'").fetchone() == (5,)


def test_drop_at_commit_is_reported(con):
    con.execute("INSERT INTO t VALUES('f', 6)")
    kill(con)
    with pytest.raises(sqlite3.OperationalError):  # the outcome of a lost COMMIT is unknown: never retried
        con.commit()
    assert con.execute("SELECT count(*) FROM t WHERE k='f'").fetchone() == (0,)  # it had not committed


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
