"""Local accounts: scrypt password hashes, lockout after repeated failures, role-based access.

Roles: employee (plans for themself; sees plans HR made for their employee_id), hr_advisor
(team analysis, reviews pseudonymous employees), admin (the admin dashboard: approvals, accounts, usage, fraud).

Self-registration (register()) creates a "free" employee, or an hr_advisor that waits for admin approval.
Accounts created by the CLI/seed are organisation-issued: plan "org" (full access, never billed).
Organisation users are invited by an HR advisor (invite()): they never use the sign-up page, they get an email link,
choose a password (accept_invite()) and belong to that advisor (invited_by), who can disable or remove them.
status: active | pending_email | pending_approval | invited | disabled.

    python -m governance.accounts create --username ana --role employee --employee-id E-001
    python -m governance.accounts set-password --username ana      (new password; also clears a lockout)
    (password read from ACCOUNT_PASSWORD or prompted)
"""
import argparse
import getpass
import hashlib
import hmac
import logging
import os
import re
from datetime import datetime, timedelta, timezone

from governance.audit import connect, now
from governance.employee_ids import is_reserved

ROLES = {"employee", "hr_advisor", "admin"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, pw_hash BLOB, salt BLOB, role TEXT,
    employee_id TEXT, display_name TEXT, created_utc TEXT, failed INTEGER DEFAULT 0, locked_until TEXT);
CREATE TABLE IF NOT EXISTS auth_events(id INTEGER PRIMARY KEY, username TEXT, event TEXT, at_utc TEXT);
"""
# added after the first release: (column, definition); existing rows become organisation accounts, active
COLUMNS = [("email", "TEXT"), ("status", "TEXT DEFAULT 'active'"), ("plan", "TEXT DEFAULT 'org'"),
           ("plan_until", "TEXT"), ("trusted", "INTEGER DEFAULT 0"), ("account_type", "TEXT DEFAULT 'org'"),
           ("terms_version", "TEXT"), ("terms_accepted_utc", "TEXT"), ("invited_by", "TEXT"),
           # full profile, and (for an HR advisor) the enterprise itself: company or school
           ("phone", "TEXT"), ("title", "TEXT"), ("department", "TEXT"), ("avatar_key", "TEXT"), ("email_pending", "TEXT"),
           ("org_name", "TEXT"), ("org_kind", "TEXT")]
TERMS_VERSION = "2026-10-22"  # bump when the Terms of Use or Privacy Policy change
STATUSES = {"active", "pending_email", "pending_approval", "invited", "disabled"}
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)
USERNAME = re.compile(r"^[a-z0-9_.-]{3,40}$")
INVALID_LOGIN = "invalid username or password"  # the one message for unknown user AND wrong password (no enumeration)
LOCKED_LOGIN = "account temporarily locked; try again later"  # same answer for auto-lockout and admin lock
# An administrator's lock is stored in the same column the sign-in check reads (users.locked_until), as a date that
# never comes, so every node sees it on its next sign-in and no schema change is needed (Postgres included).
ADMIN_LOCK_UNTIL = "9999-12-31T23:59:59+00:00"
PENDING_SIGNUP_MINUTES = 30  # an unverified sign-up holds its username/email this long before someone else may take it
log = logging.getLogger(__name__)

# Listeners for new login keys (usernames, emails): the sign-in Bloom filter (governance/bloom.py) subscribes so it
# never answers "no such account" for an account that was just created here. Keys are passed on, never logged.
_LOGIN_KEY_LISTENERS: list = []


def on_login_keys(fn) -> None:
    if fn not in _LOGIN_KEY_LISTENERS:
        _LOGIN_KEY_LISTENERS.append(fn)


def note_login_keys(*keys) -> None:
    """Call after any write that adds a username or email someone can sign in with."""
    for fn in list(_LOGIN_KEY_LISTENERS):
        try:
            fn(*keys)
        except Exception:  # a listener must never break account creation
            log.exception("login key listener failed")


class AuthError(ValueError):
    pass


class PendingEmail(AuthError):
    """Right password, but the email was never verified: the caller sends a fresh code instead of failing."""


def init(con):
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript(SCHEMA)
    have = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    with con:
        for name, kind in COLUMNS:
            if name not in have:
                con.execute(f"ALTER TABLE users ADD COLUMN {name} {kind}")
    return con


def _check_password(password: str):
    if len(password) < 10 or password.lower() == password or not re.search(r"\d", password):
        raise AuthError("password: >=10 chars with an uppercase letter and a digit")


# Password hashing. v2 = scrypt N=2^17, r=8, p=1 (OWASP minimum), tagged so old N=2^14 hashes keep working and are
# upgraded on the next successful sign-in (see authenticate). Needs ~128 MiB per hash, hence maxmem.
_V2 = b"s2$"


def _legacy_hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def _hash(password: str, salt: bytes) -> bytes:
    return _V2 + hashlib.scrypt(password.encode(), salt=salt, n=2 ** 17, r=8, p=1, maxmem=2 ** 28, dklen=32)


def _verify(password: str, salt: bytes, stored: bytes) -> bool:
    stored = bytes(stored)
    calc = _hash(password or "", salt) if stored.startswith(_V2) else _legacy_hash(password or "", salt)
    return hmac.compare_digest(calc, stored)


_DUMMY_SALT = os.urandom(16)
_DUMMY_HASH = _hash("dummy-password-never-valid", _DUMMY_SALT)  # same work for unknown users: no timing enumeration


def burn_dummy(password: str) -> bool:
    """The same scrypt work as checking a real (v2) password, for logins that cannot succeed. Always False."""
    _verify(password or "", _DUMMY_SALT, _DUMMY_HASH)
    return False


def create_user(con, username: str, password: str, role: str, employee_id: str | None = None,
                display_name: str = "") -> None:
    init(con)
    username = username.strip().lower()
    if not USERNAME.match(username):
        raise AuthError("username: 3-40 chars, a-z 0-9 _ . -")
    if role not in ROLES:
        raise AuthError(f"role must be one of {sorted(ROLES)}")
    _check_password(password)
    if role == "employee" and not employee_id:
        raise AuthError("employees need an employee_id (pseudonymous, e.g. E-001)")
    # HR analyses generate pseudonymous IDs; a new account taking one would inherit those plans.
    if employee_id and (is_reserved(con, employee_id)
                        or con.execute("SELECT 1 FROM plans WHERE subject_id=?", (employee_id,)).fetchone()):
        raise AuthError(f"employee_id {employee_id} is already used by HR analysis plans")
    salt = os.urandom(16)
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc) VALUES(?,?,?,?,?,?,?)",
                    (username, _hash(password, salt), salt, role, employee_id, display_name or username, now()))
    note_login_keys(username)


def register(con, username: str, email: str, password: str, account_type: str, display_name: str = "",
             verify_email: bool = False) -> dict:
    """Self-service sign-up. Individuals start on the free plan; HR advisors wait for an admin to approve them.
    verify_email: the account first waits for the emailed code."""
    init(con)
    username, email = username.strip().lower(), email.strip().lower()
    if account_type not in ("individual", "hr"):
        raise AuthError("account type must be individual or hr")
    if not USERNAME.match(username):
        raise AuthError("username: 3-40 chars, a-z 0-9 _ . -")
    if not EMAIL.match(email):
        raise AuthError("enter a valid email address")
    _check_password(password)
    # An unverified sign-up never became an account: starting again with the same username AND email replaces it.
    # Anyone else (another email for that username, or that email under another username) may only replace it once
    # it has expired, so nobody can keep cancelling or squatting someone's sign-up while they verify their email.
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=PENDING_SIGNUP_MINUTES)).isoformat(timespec="seconds")
    stale = [r[0] for r in con.execute(
        "SELECT username FROM users WHERE status='pending_email' AND ((username=? AND lower(email)=?) "
        "OR ((username=? OR lower(email)=?) AND created_utc<?))", (username, email, username, email, cutoff))]
    with con:
        for old in stale:
            con.execute("DELETE FROM users WHERE username=?", (old,))
    if con.execute("SELECT 1 FROM users WHERE username=? OR lower(email)=?", (username, email)).fetchone():
        raise AuthError("that username or email is already registered")
    role = "employee" if account_type == "individual" else "hr_advisor"
    employee_id = "U-" + os.urandom(4).hex() if role == "employee" else None  # pseudonymous id for their own plans
    status = "pending_email" if verify_email else ("active" if role == "employee" else "pending_approval")
    # HR analyses generate pseudonymous IDs; a new account taking one would inherit those plans.
    if employee_id and (is_reserved(con, employee_id)
                        or con.execute("SELECT 1 FROM plans WHERE subject_id=?", (employee_id,)).fetchone()):
        raise AuthError(f"employee_id {employee_id} is already used by HR analysis plans")
    salt = os.urandom(16)
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc,email,status,plan,"
                    "account_type,terms_version,terms_accepted_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (username, _hash(password, salt), salt, role, employee_id, (display_name or username).strip()[:60], now(),
                     email, status, "free", account_type, TERMS_VERSION, now()))
    note_login_keys(username, email)
    _event(con, username, "registered")
    return {"username": username, "role": role, "status": status}


def invite(con, hr: str, email: str, display_name: str = "") -> dict:
    """An organisation user, created by an HR advisor. No password until they accept the emailed invite; the
    username comes from the email (made unique)."""
    init(con)
    email = email.strip().lower()
    if not EMAIL.match(email):
        raise AuthError("enter a valid email address")
    if con.execute("SELECT 1 FROM users WHERE lower(email)=?", (email,)).fetchone():
        raise AuthError("that email already has an account")
    stem = (re.sub(r"[^a-z0-9_.-]", "", email.split("@")[0]) or "member")[:32].ljust(3, "0")
    username, n = stem, 1
    while con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        n += 1
        username = f"{stem}{n}"
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc,email,status,plan,"
                    "account_type,invited_by) VALUES(?,NULL,NULL,'employee',?,?,?,?,'invited','org','org',?)",
                    (username, "U-" + os.urandom(4).hex(), (display_name or username).strip()[:60], now(), email, hr))
    note_login_keys(username, email)
    _event(con, username, f"invited by {hr}")
    return account(con, username)


def accept_invite(con, username: str, password: str):
    """The invited person chose a password and accepted the terms: the account is ready."""
    _check_password(password)
    salt = os.urandom(16)
    with con:
        n = con.execute("UPDATE users SET pw_hash=?, salt=?, status='active', terms_version=?, terms_accepted_utc=? "
                        "WHERE username=? AND status='invited'", (_hash(password, salt), salt, TERMS_VERSION, now(), username)).rowcount
    if not n:
        raise AuthError("this invite was already used or withdrawn")
    _event(con, username, "invite_accepted")


def email_verified(con, username: str) -> str:
    """After the emailed code: individuals become active, HR advisors wait for admin approval."""
    row = con.execute("SELECT role FROM users WHERE username=? AND status='pending_email'", (username,)).fetchone()
    if not row:
        raise AuthError("nothing to verify")
    status = "active" if row[0] == "employee" else "pending_approval"
    with con:
        con.execute("UPDATE users SET status=? WHERE username=?", (status, username))
    return status


def set_password(con, username: str, password: str):
    """Forgotten-password reset: new hash, lock cleared. The caller signs the account out everywhere."""
    _check_password(password)
    salt = os.urandom(16)
    with con:
        # clears an automatic lockout, never an administrator's lock (a reset link must not undo it)
        n = con.execute("UPDATE users SET pw_hash=?, salt=?, failed=0, "
                        "locked_until=CASE WHEN locked_until=? THEN locked_until ELSE NULL END WHERE username=?",
                        (_hash(password, salt), salt, ADMIN_LOCK_UNTIL, username)).rowcount
    if not n:
        raise AuthError("no such account")
    _event(con, username, "password_reset")


def check_password(con, username: str, password: str) -> bool:
    """For sensitive actions by a signed-in user (e.g. deleting the account). No lockout side effects."""
    row = con.execute("SELECT pw_hash, salt FROM users WHERE username=?", (username,)).fetchone()
    if not (row and row[0]):
        _verify(password or "", _DUMMY_SALT, _DUMMY_HASH)
        return False
    return _verify(password or "", row[1], row[0])


def find_login(con, login: str) -> dict | None:
    """An account by username or email (for 'forgot password')."""
    init(con)
    login = (login or "").strip().lower()
    row = con.execute("SELECT username FROM users WHERE username=? OR lower(email)=?", (login, login)).fetchone()
    return account(con, row[0]) if row else None


def set_status(con, username: str, status: str):
    if status not in STATUSES:
        raise AuthError("unknown status")
    with con:
        n = con.execute("UPDATE users SET status=? WHERE username=? AND role!='admin'", (status, username)).rowcount
    if not n:
        raise AuthError("no such account (admins are managed from the command line)")
    _event(con, username, f"status:{status}")


def set_plan(con, username: str, plan: str, until: str | None):
    with con:
        con.execute("UPDATE users SET plan=?, plan_until=? WHERE username=?", (plan, until, username))
    _event(con, username, f"plan:{plan}")


def effective_plan(plan: str | None, plan_until: str | None) -> str:
    """Paid plans last until plan_until; then the account is back on free. org and free never expire."""
    if plan in ("pro", "team") and (not plan_until or datetime.fromisoformat(plan_until) < datetime.now(timezone.utc)):
        return "free"
    return plan or "org"


KEYS = ["username", "role", "employee_id", "display_name", "email", "status", "plan", "plan_until", "trusted",
        "account_type", "created_utc", "terms_version", "terms_accepted_utc", "invited_by",
        "phone", "title", "department", "avatar_key", "email_pending", "org_name", "org_kind"]


def account(con, username: str) -> dict | None:
    init(con)
    r = con.execute(f"SELECT {','.join(KEYS)} FROM users WHERE username=?", (username,)).fetchone()
    if not r:
        return None
    a = dict(zip(KEYS, r))
    a["effective_plan"] = effective_plan(a["plan"], a["plan_until"])
    return a


def load_for_login(con, login: str) -> tuple[str, tuple | None]:
    """Step 1 of a sign-in (fast, under the caller's DB lock): the account row for a username or email, or None.
    Raises AuthError if the account is locked."""
    init(con)
    username = (login or "").strip().lower()
    if "@" in username:  # people sign in with their email too ("forgot password" accepts either)
        by_email = con.execute("SELECT username FROM users WHERE lower(email)=?", (username,)).fetchone()
        username = by_email[0] if by_email else username
    row = con.execute("SELECT pw_hash,salt,role,employee_id,display_name,failed,locked_until,status FROM users WHERE username=?",
                      (username,)).fetchone()
    if row and lock_state(row[6])["locked"]:  # automatic lockout or an administrator's lock: same answer
        _event(con, username, "locked")
        raise AuthError(LOCKED_LOGIN)
    return username, row


def check_login(row, password: str) -> tuple[bool, tuple[bytes, bytes] | None]:
    """Step 2 (slow: scrypt). Call it with NO lock held. Returns (password ok, (new hash, salt) to store or None).
    Unknown and invited (no password yet) accounts burn the same work, so the time taken does not reveal them."""
    if not (row and row[0]):
        return burn_dummy(password), None
    stored = bytes(row[0])
    if stored.startswith(_V2):
        return _verify(password or "", row[1], stored), None
    # legacy N=2^14 hash: check it, and always do the v2 work too (as long as a v2 check, and it is the upgrade)
    ok = hmac.compare_digest(_legacy_hash(password or "", row[1]), stored)
    salt = os.urandom(16)
    new = _hash(password or "", salt)
    return ok, ((new, salt) if ok else None)


def finish_login(con, username: str, row, ok: bool, upgrade=None, max_failures: int = 5, lock_minutes: int = 5) -> dict:
    """Step 3 (fast, under the caller's DB lock): count a failure / lock, or check the status and sign in."""
    if not ok:
        if row:
            # Count in SQL (concurrent attempts may have counted meanwhile). Keep counting (do not reset to 0 on lock)
            # and back off exponentially: 5, 10, 20 ... minutes, max 24 h. A successful sign-in clears the counter.
            with con:
                con.execute("UPDATE users SET failed=COALESCE(failed,0)+1 WHERE username=?", (username,))
            got = con.execute("SELECT failed FROM users WHERE username=?", (username,)).fetchone()
            failed = (got[0] or 0) if got else 0
            if failed >= max_failures and failed % max_failures == 0:
                minutes = min(lock_minutes * 2 ** (failed // max_failures - 1), 24 * 60)
                lock = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
                with con:  # never shorten or replace an administrator's lock
                    con.execute("UPDATE users SET locked_until=? WHERE username=? AND (locked_until IS NULL OR locked_until<>?)",
                                (lock, username, ADMIN_LOCK_UNTIL))
        _event(con, username, "login_failed")
        raise AuthError(INVALID_LOGIN)  # same message: no user enumeration
    # Read the lock and status again: an admin may have locked (or disabled) the account while scrypt ran outside the
    # lock, possibly on another node. The database is the only source of lock state; nothing is cached.
    fresh = con.execute("SELECT locked_until, status FROM users WHERE username=?", (username,)).fetchone()
    if not fresh:
        _event(con, username, "login_failed")
        raise AuthError(INVALID_LOGIN)
    if lock_state(fresh[0])["locked"]:
        _event(con, username, "locked")
        raise AuthError(LOCKED_LOGIN)
    status = fresh[1] or "active"
    if status == "pending_email":
        raise PendingEmail("verify your email first: we sent you a new code")
    if status != "active":  # the password was right, so saying why does not reveal whether the account exists
        _event(con, username, f"login_{status}")
        raise AuthError({"disabled": "this account is disabled; contact support",
                         "pending_email": "verify your email first: enter the code we sent you",
                         "pending_approval": "your HR account is waiting for an administrator to approve it",
                         "invited": "accept the invite in your email first"}[status])
    with con:
        con.execute("UPDATE users SET failed=0, locked_until=NULL WHERE username=? AND (locked_until IS NULL OR locked_until<>?)",
                    (username, ADMIN_LOCK_UNTIL))
        if upgrade:  # legacy hash -> v2, computed outside the lock; only if the password was not changed meanwhile
            con.execute("UPDATE users SET pw_hash=?, salt=? WHERE username=? AND pw_hash=?",
                        (upgrade[0], upgrade[1], username, bytes(row[0])))
    _event(con, username, "login")
    return {"username": username, "role": row[2], "employee_id": row[3], "display_name": row[4]}


# --- lock state and administrator lock / unlock ------------------------------------------------------------
class LockRefused(AuthError):
    """An admin lock that is not allowed (yourself, or the last administrator who can still sign in)."""


def lock_state(locked_until, failed=None) -> dict:
    """What users.locked_until means, the one place it is decided (sign-in, sessions and the admin list use it):
    {"locked": bool, "kind": "admin" | "auto" | None, "until": ISO time of an automatic lock or None, "failed": n}."""
    out = {"locked": False, "kind": None, "until": None, "failed": int(failed or 0)}
    if not locked_until:
        return out
    if locked_until == ADMIN_LOCK_UNTIL:
        return out | {"locked": True, "kind": "admin"}
    try:
        until = datetime.fromisoformat(locked_until)
    except ValueError:  # unreadable: treat as locked by an admin rather than as open
        return out | {"locked": True, "kind": "admin"}
    if until > datetime.now(timezone.utc):
        return out | {"locked": True, "kind": "auto", "until": locked_until}
    return out


def lock_info(con, username: str) -> dict | None:
    """Current lock state straight from the users table (+ who locked it and when, for an admin lock)."""
    r = con.execute("SELECT locked_until, failed FROM users WHERE username=?", (username,)).fetchone()
    if not r:
        return None
    st = lock_state(r[0], r[1])
    if st["kind"] == "admin":
        ev = con.execute("SELECT event, at_utc FROM auth_events WHERE username=? AND event LIKE 'admin_lock by %' "
                         "ORDER BY id DESC LIMIT 1", (username,)).fetchone()
        st |= {"by": ev[0][len("admin_lock by "):] if ev else None, "since": ev[1] if ev else None}
    return st


def admin_lock(con, username: str, by: str) -> dict:
    """An administrator locks an account of any role. Sign-ins then answer exactly like an automatic lockout, until
    an administrator unlocks it (a password reset does not). The caller ends the account's sessions.
    Refuses to lock yourself, or the last active administrator who is not locked."""
    username = (username or "").strip().lower()
    if username == (by or "").strip().lower():
        raise LockRefused("You can't lock your own account.")
    r = con.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
    if not r:
        raise AuthError("no such account")
    with con:
        # one statement, so the "another admin can still sign in" check and the lock happen together
        n = con.execute(
            "UPDATE users SET locked_until=? WHERE username=? AND (role<>'admin' OR (SELECT COUNT(*) FROM users o "
            "WHERE o.role='admin' AND o.username<>? AND COALESCE(o.status,'active')='active' "
            "AND (o.locked_until IS NULL OR o.locked_until<?)) > 0)",
            (ADMIN_LOCK_UNTIL, username, username, datetime.now(timezone.utc).isoformat())).rowcount
    if not n:
        raise LockRefused("This is the last administrator who can sign in; it can't be locked.")
    _event(con, username, f"admin_lock by {by}")  # audit: whom (username), who, when (at_utc), action
    return lock_info(con, username)


def admin_unlock(con, username: str, by: str) -> dict:
    """An administrator unlocks an account of any role: lifts an admin lock or an automatic lockout and clears the
    failure counter (which also resets the lockout back-off). Returns {"was": previous lock state, "now": ...}."""
    username = (username or "").strip().lower()
    before = lock_info(con, username)
    if before is None:
        raise AuthError("no such account")
    with con:
        con.execute("UPDATE users SET failed=0, locked_until=NULL WHERE username=?", (username,))
    _event(con, username, f"admin_unlock by {by} (was {before['kind'] or 'not locked'})")
    return {"was": before, "now": lock_info(con, username)}


def authenticate(con, username: str, password: str, max_failures: int = 5, lock_minutes: int = 5) -> dict:
    """All three steps in one call (CLI, tests, single-threaded callers). The API runs them separately so the slow
    hash happens outside its DB lock (see server/api.py login)."""
    username, row = load_for_login(con, username)
    ok, upgrade = check_login(row, password)
    return finish_login(con, username, row, ok, upgrade, max_failures, lock_minutes)


def _event(con, username, event):
    with con:
        con.execute("INSERT INTO auth_events(username,event,at_utc) VALUES(?,?,?)", (username, event, now()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["create", "set-password", "unlock"])
    ap.add_argument("--username", required=True)
    ap.add_argument("--role", choices=sorted(ROLES))
    ap.add_argument("--employee-id")
    ap.add_argument("--display-name", default="")
    a = ap.parse_args()
    if a.action == "unlock":  # break-glass, e.g. every administrator locked out: lifts any lock, clears failures
        r = admin_unlock(init(connect()), a.username, "cli")
        print(f"{a.username} unlocked (was {r['was']['kind'] or 'not locked'})")
        return
    pw = os.environ.get("ACCOUNT_PASSWORD") or getpass.getpass("Password: ")
    con = init(connect())
    if a.action == "set-password":  # also unlocks; sessions end so the old password stops working everywhere
        set_password(con, a.username.strip().lower(), pw)
        with con:
            con.execute("DELETE FROM sessions WHERE username=?", (a.username.strip().lower(),))
        print(f"new password set for {a.username}; signed out everywhere")
        return
    if not a.role:
        ap.error("--role is required to create an account")
    create_user(con, a.username, pw, a.role, a.employee_id, a.display_name)
    print(f"created {a.username} ({a.role})")


if __name__ == "__main__":
    main()
