"""Administrator lock / unlock, on the accounts store (the API side is in test_api.py). The lock lives in
users.locked_until, the column the sign-in check reads, so every connection (worker, node) sees it at once."""
import pytest

from governance import accounts
from governance.audit import connect

PW = "Correct-Horse9"


def db(path=":memory:"):
    con = accounts.init(connect(path))
    for name, role in (("root1", "admin"), ("root2", "admin"), ("ana", "employee"), ("hr1", "hr_advisor")):
        accounts.create_user(con, name, PW, role, "E-001" if role == "employee" else None)
    accounts.register(con, "pat1", "pat1@example.com", PW, "individual")  # a personal (self-service) account
    return con


def _locked(con, name):
    with pytest.raises(accounts.AuthError) as e:
        accounts.authenticate(con, name, PW)
    return str(e.value)


def events(con, name):
    return [r[0] for r in con.execute("SELECT event FROM auth_events WHERE username=? ORDER BY id", (name,))]


@pytest.mark.parametrize("name", ["ana", "hr1", "pat1", "root2"])  # every role, administrators included
def test_admin_lock_blocks_sign_in_and_unlock_restores_it(name):
    con = db()
    st = accounts.admin_lock(con, name, "root1")
    assert st["locked"] and st["kind"] == "admin" and st["by"] == "root1" and st["since"]
    assert _locked(con, name) == accounts.LOCKED_LOGIN  # the existing "temporarily locked" answer
    r = accounts.admin_unlock(con, name, "root1")
    assert r["was"]["kind"] == "admin" and not r["now"]["locked"]
    assert accounts.authenticate(con, name, PW)["username"] == name  # the very next attempt works


def test_unlock_of_an_auto_locked_account_clears_failures_and_backoff():
    con = db()
    for _ in range(10):  # two lockout rounds: the back-off level comes from the failure counter
        with pytest.raises(accounts.AuthError):
            accounts.authenticate(con, "ana", "Wrong-pass99")
        con.execute("UPDATE users SET locked_until=NULL WHERE username='ana' AND locked_until<>?", (accounts.ADMIN_LOCK_UNTIL,))
    with pytest.raises(accounts.AuthError):  # 11th failure, then lock it for real
        accounts.authenticate(con, "ana", "Wrong-pass99")
    con.execute("UPDATE users SET failed=14 WHERE username='ana'")
    with pytest.raises(accounts.AuthError):
        accounts.authenticate(con, "ana", "Wrong-pass99")  # 15: third round, 20 minutes
    st = accounts.lock_info(con, "ana")
    assert st["locked"] and st["kind"] == "auto" and st["until"] and st["failed"] == 15
    r = accounts.admin_unlock(con, "ana", "root1")
    assert r["was"]["kind"] == "auto" and r["now"] == {"locked": False, "kind": None, "until": None, "failed": 0}
    assert accounts.authenticate(con, "ana", PW)["username"] == "ana"
    for _ in range(4):  # back-off level reset: the next lock comes after max_failures again, not at once
        with pytest.raises(accounts.AuthError, match="invalid"):
            accounts.authenticate(con, "ana", "Wrong-pass99")
    assert not accounts.lock_info(con, "ana")["locked"]


def test_cannot_lock_yourself_or_the_last_admin():
    con = db()
    with pytest.raises(accounts.LockRefused, match="your own"):
        accounts.admin_lock(con, "root1", "root1")
    accounts.admin_lock(con, "root2", "root1")
    accounts.create_user(con, "root3", PW, "admin")
    accounts.admin_lock(con, "root3", "root1")
    # root1 is now the only admin who can sign in: nobody (not even another admin's stale session) may lock it
    with pytest.raises(accounts.LockRefused, match="last administrator"):
        accounts.admin_lock(con, "root1", "root2")
    assert not accounts.lock_info(con, "root1")["locked"]
    with pytest.raises(accounts.AuthError, match="no such account"):
        accounts.admin_lock(con, "ghost", "root1")
    with pytest.raises(accounts.AuthError, match="no such account"):
        accounts.admin_unlock(con, "ghost", "root1")


def test_audit_entries_say_who_whom_and_what_without_secrets():
    con = db()
    accounts.admin_lock(con, "ana", "root1")
    accounts.admin_unlock(con, "ana", "root2")
    rows = con.execute("SELECT username, event, at_utc FROM auth_events WHERE username='ana' AND event LIKE 'admin_%' ORDER BY id").fetchall()
    assert [(r[0], r[1]) for r in rows] == [("ana", "admin_lock by root1"), ("ana", "admin_unlock by root2 (was admin)")]
    assert all(r[2] for r in rows)  # when
    assert not any(PW in r[1] for r in rows)


def test_password_reset_does_not_lift_an_admin_lock_but_does_lift_an_auto_lock():
    con = db()
    accounts.admin_lock(con, "ana", "root1")
    accounts.set_password(con, "ana", "Another-Pass77")
    assert accounts.lock_info(con, "ana")["kind"] == "admin"
    accounts.admin_unlock(con, "ana", "root1")
    con.execute("UPDATE users SET failed=5, locked_until='2999-01-01T00:00:00+00:00' WHERE username='ana'")
    accounts.set_password(con, "ana", "Third-Pass77")
    assert not accounts.lock_info(con, "ana")["locked"]


def test_lock_during_a_sign_in_wins_and_failures_never_overwrite_it():
    con = db()
    name, row = accounts.load_for_login(con, "ana")  # step 1 passed before the lock ...
    ok, up = accounts.check_login(row, PW)
    accounts.admin_lock(con, "ana", "root1")  # ... an admin locks it while scrypt runs (maybe on another node)
    with pytest.raises(accounts.AuthError, match="locked"):
        accounts.finish_login(con, name, row, ok, up)
    assert accounts.lock_info(con, "ana")["kind"] == "admin"
    con.execute("UPDATE users SET failed=4 WHERE username='ana'")
    with pytest.raises(accounts.AuthError):
        accounts.finish_login(con, name, row, False)  # the 5th failure would set an automatic lock
    assert accounts.lock_info(con, "ana")["kind"] == "admin"  # still the admin's lock, not a 5-minute one


def test_state_is_shared_by_every_connection(tmp_path):
    path = str(tmp_path / "a.sqlite3")
    one, two = db(path), accounts.init(connect(path))  # two workers on one database
    accounts.admin_lock(one, "hr1", "root1")
    assert accounts.lock_info(two, "hr1")["kind"] == "admin"
    assert _locked(two, "hr1") == accounts.LOCKED_LOGIN
    accounts.admin_unlock(two, "hr1", "root2")
    assert not accounts.lock_info(one, "hr1")["locked"]
    assert accounts.authenticate(one, "hr1", PW)["username"] == "hr1"
