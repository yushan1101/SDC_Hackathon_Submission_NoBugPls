"""Sign-in hardening: one answer for unknown user and wrong password, hashing outside the lock, lockout back-off,
hash upgrade, sign-up squatting."""
import time
from datetime import datetime, timedelta, timezone

import pytest

from governance import accounts
from governance.audit import connect

PW = "Correct-Horse9"


def db():
    con = accounts.init(connect(":memory:"))
    accounts.create_user(con, "ana", PW, "employee", "E-001")
    return con


def _fail(con, login, pw="Wrong-pass99"):
    with pytest.raises(accounts.AuthError) as e:
        accounts.authenticate(con, login, pw)
    return type(e.value), str(e.value)


def test_unknown_user_and_wrong_password_look_the_same():
    con = db()
    wrong = _fail(con, "ana")
    unknown = _fail(con, "no-such-user")
    unknown_email = _fail(con, "nobody@example.com")
    assert wrong == unknown == unknown_email == (accounts.AuthError, accounts.INVALID_LOGIN)


def test_unknown_user_burns_the_same_hash_work():
    con = db()

    def timed(login):
        best = 1e9
        for _ in range(3):
            t = time.perf_counter()
            with pytest.raises(accounts.AuthError):
                accounts.authenticate(con, login, "Wrong-pass99", max_failures=1000)
            best = min(best, time.perf_counter() - t)
        return best
    real, ghost = timed("ana"), timed("no-such-user")
    assert 0.6 < ghost / real < 1.6  # same scrypt cost; no fast path for names that do not exist


def test_burn_dummy_costs_a_real_hash_and_is_never_true():
    salt = b"s" * 16
    t = time.perf_counter()
    accounts._hash("x", salt)
    one = time.perf_counter() - t
    t = time.perf_counter()
    assert accounts.burn_dummy(PW) is False
    assert time.perf_counter() - t > one * 0.5


def test_split_login_steps_match_authenticate():
    con = db()
    name, row = accounts.load_for_login(con, " ANA ")
    ok, upgrade = accounts.check_login(row, PW)  # what the API runs without holding DB_LOCK
    assert name == "ana" and ok and upgrade is None
    assert accounts.finish_login(con, name, row, ok, upgrade)["employee_id"] == "E-001"
    name, row = accounts.load_for_login(con, "ghost")
    assert row is None and accounts.check_login(row, PW) == (False, None)
    with pytest.raises(accounts.AuthError, match=accounts.INVALID_LOGIN):
        accounts.finish_login(con, name, row, False)


def test_legacy_hash_is_upgraded_on_login_and_not_over_a_new_password():
    con = db()
    salt = b"l" * 16
    with con:
        con.execute("UPDATE users SET pw_hash=?, salt=? WHERE username='ana'", (accounts._legacy_hash(PW, salt), salt))
    name, row = accounts.load_for_login(con, "ana")
    ok, upgrade = accounts.check_login(row, PW)
    assert ok and upgrade and upgrade[0].startswith(accounts._V2)
    accounts.finish_login(con, name, row, ok, upgrade)
    assert bytes(con.execute("SELECT pw_hash FROM users WHERE username='ana'").fetchone()[0]).startswith(accounts._V2)
    assert accounts.authenticate(con, "ana", PW)["username"] == "ana"
    # a password reset between "check" and "finish" must win over the (stale) upgrade
    with con:
        con.execute("UPDATE users SET pw_hash=?, salt=? WHERE username='ana'", (accounts._legacy_hash(PW, salt), salt))
    name, row = accounts.load_for_login(con, "ana")
    ok, upgrade = accounts.check_login(row, PW)
    accounts.set_password(con, "ana", "Brand-New-Pass7")
    accounts.finish_login(con, name, row, ok, upgrade)
    assert accounts.authenticate(con, "ana", "Brand-New-Pass7")
    _fail(con, "ana", PW)


def test_lockout_keeps_counting_and_backs_off():
    con2 = db()
    for _ in range(3):
        with pytest.raises(accounts.AuthError):
            accounts.authenticate(con2, "ana", "Wrong-pass99", max_failures=3, lock_minutes=5)
    failed, until = con2.execute("SELECT failed, locked_until FROM users WHERE username='ana'").fetchone()
    assert failed == 3  # not reset to 0 when the lock starts
    first = datetime.fromisoformat(until) - datetime.now(timezone.utc)
    assert timedelta(minutes=4) < first <= timedelta(minutes=5)
    with con2:  # let the lock expire, fail 3 more times: the next lock is twice as long
        con2.execute("UPDATE users SET locked_until=NULL WHERE username='ana'")
    for _ in range(3):
        with pytest.raises(accounts.AuthError):
            accounts.authenticate(con2, "ana", "Wrong-pass99", max_failures=3, lock_minutes=5)
    failed, until = con2.execute("SELECT failed, locked_until FROM users WHERE username='ana'").fetchone()
    assert failed == 6 and datetime.fromisoformat(until) - datetime.now(timezone.utc) > timedelta(minutes=9)
    with pytest.raises(accounts.AuthError, match="locked"):
        accounts.authenticate(con2, "ana", PW, max_failures=3)


def test_pending_signup_cannot_be_squatted_or_cancelled_by_someone_else():
    con = accounts.init(connect(":memory:"))
    accounts.register(con, "victim1", "victim@example.com", PW, "individual", verify_email=True)
    with pytest.raises(accounts.AuthError, match="already registered"):  # same username, other email
        accounts.register(con, "victim1", "attacker@example.com", PW, "individual", verify_email=True)
    with pytest.raises(accounts.AuthError, match="already registered"):  # same email, other username
        accounts.register(con, "attacker1", "victim@example.com", PW, "individual", verify_email=True)
    assert con.execute("SELECT email FROM users WHERE username='victim1'").fetchone()[0] == "victim@example.com"
    # the same person starting again (same username and email) still replaces their own pending sign-up
    assert accounts.register(con, "victim1", "victim@example.com", PW, "individual", verify_email=True)["status"] == "pending_email"
    # once it has expired, the name is free again
    old = (datetime.now(timezone.utc) - timedelta(minutes=accounts.PENDING_SIGNUP_MINUTES + 1)).isoformat(timespec="seconds")
    with con:
        con.execute("UPDATE users SET created_utc=? WHERE username='victim1'", (old,))
    assert accounts.register(con, "victim1", "someone@example.com", PW, "individual", verify_email=True)["username"] == "victim1"


def test_pending_email_login_via_email_raises_pending():
    con = accounts.init(connect(":memory:"))
    accounts.register(con, "mailer1", "Mailer1@Example.com", PW, "individual", verify_email=True)
    with pytest.raises(accounts.PendingEmail):
        accounts.authenticate(con, "mailer1@example.com", PW)
    assert accounts.find_login(con, "mailer1@example.com")["username"] == "mailer1"  # what /api/login now looks up
