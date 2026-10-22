"""Local accounts: scrypt password hashes, lockout after repeated failures, role-based access.

Roles: employee (plans for themself; sees plans HR made for their employee_id), hr_advisor
(team analysis, reviews pseudonymous employees), admin (the admin dashboard: approvals, accounts, usage, fraud).

Self-registration (register()) creates a "free" employee, or an hr_advisor that waits for admin approval.
Accounts created by the CLI/seed are organisation-issued: plan "org" (full access, never billed).
status: active | pending_email | pending_approval | disabled.

    python -m governance.accounts create --username ana --role employee --employee-id E-001
    (password read from ACCOUNT_PASSWORD or prompted)
"""
import argparse
import getpass
import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone

from governance.audit import connect, now

ROLES = {"employee", "hr_advisor", "admin"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, pw_hash BLOB, salt BLOB, role TEXT,
    employee_id TEXT, display_name TEXT, created_utc TEXT, failed INTEGER DEFAULT 0, locked_until TEXT);
CREATE TABLE IF NOT EXISTS auth_events(id INTEGER PRIMARY KEY, username TEXT, event TEXT, at_utc TEXT);
"""
# added after the first release: (column, definition); existing rows become organisation accounts, active
COLUMNS = [("email", "TEXT"), ("status", "TEXT DEFAULT 'active'"), ("plan", "TEXT DEFAULT 'org'"),
           ("plan_until", "TEXT"), ("trusted", "INTEGER DEFAULT 0"), ("account_type", "TEXT DEFAULT 'org'")]
STATUSES = {"active", "pending_email", "pending_approval", "disabled"}
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$", re.I)
USERNAME = re.compile(r"^[a-z0-9_.-]{3,40}$")


class AuthError(ValueError):
    pass


def init(con):
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


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


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
    salt = os.urandom(16)
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc) VALUES(?,?,?,?,?,?,?)",
                    (username, _hash(password, salt), salt, role, employee_id, display_name or username, now()))


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
    if con.execute("SELECT 1 FROM users WHERE username=? OR lower(email)=?", (username, email)).fetchone():
        raise AuthError("that username or email is already registered")
    role = "employee" if account_type == "individual" else "hr_advisor"
    employee_id = "U-" + os.urandom(4).hex() if role == "employee" else None  # pseudonymous id for their own plans
    status = "pending_email" if verify_email else ("active" if role == "employee" else "pending_approval")
    salt = os.urandom(16)
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc,email,status,plan,"
                    "account_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (username, _hash(password, salt), salt, role, employee_id, (display_name or username).strip()[:60], now(),
                     email, status, "free", account_type))
    _event(con, username, "registered")
    return {"username": username, "role": role, "status": status}


def email_verified(con, username: str) -> str:
    """After the emailed code: individuals become active, HR advisors wait for admin approval."""
    row = con.execute("SELECT role FROM users WHERE username=? AND status='pending_email'", (username,)).fetchone()
    if not row:
        raise AuthError("nothing to verify")
    status = "active" if row[0] == "employee" else "pending_approval"
    with con:
        con.execute("UPDATE users SET status=? WHERE username=?", (status, username))
    return status


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
        "account_type", "created_utc"]


def account(con, username: str) -> dict | None:
    init(con)
    r = con.execute(f"SELECT {','.join(KEYS)} FROM users WHERE username=?", (username,)).fetchone()
    if not r:
        return None
    a = dict(zip(KEYS, r))
    a["effective_plan"] = effective_plan(a["plan"], a["plan_until"])
    return a


def authenticate(con, username: str, password: str, max_failures: int = 5, lock_minutes: int = 5) -> dict:
    init(con)
    username = (username or "").strip().lower()
    row = con.execute("SELECT pw_hash,salt,role,employee_id,display_name,failed,locked_until,status FROM users WHERE username=?",
                      (username,)).fetchone()
    t = datetime.now(timezone.utc)
    if row and row[6] and datetime.fromisoformat(row[6]) > t:
        _event(con, username, "locked")
        raise AuthError("account temporarily locked; try again later")
    ok = bool(row) and hmac.compare_digest(_hash(password or "", row[1]), row[0])
    if not ok:
        if row:
            failed = row[5] + 1
            lock = (t + timedelta(minutes=lock_minutes)).isoformat() if failed >= max_failures else None
            with con:
                con.execute("UPDATE users SET failed=?, locked_until=? WHERE username=?",
                            (0 if lock else failed, lock, username))
        _event(con, username, "login_failed")
        raise AuthError("invalid username or password")  # same message: no user enumeration
    status = row[7] or "active"
    if status != "active":  # the password was right, so saying why does not reveal whether the account exists
        _event(con, username, f"login_{status}")
        raise AuthError({"disabled": "this account is disabled; contact support",
                         "pending_email": "verify your email first: enter the code we sent you",
                         "pending_approval": "your HR account is waiting for an administrator to approve it"}[status])
    with con:
        con.execute("UPDATE users SET failed=0, locked_until=NULL WHERE username=?", (username,))
    _event(con, username, "login")
    return {"username": username, "role": row[2], "employee_id": row[3], "display_name": row[4]}


def _event(con, username, event):
    with con:
        con.execute("INSERT INTO auth_events(username,event,at_utc) VALUES(?,?,?)", (username, event, now()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["create"])
    ap.add_argument("--username", required=True)
    ap.add_argument("--role", required=True, choices=sorted(ROLES))
    ap.add_argument("--employee-id")
    ap.add_argument("--display-name", default="")
    a = ap.parse_args()
    pw = os.environ.get("ACCOUNT_PASSWORD") or getpass.getpass("Password: ")
    create_user(connect(), a.username, pw, a.role, a.employee_id, a.display_name)
    print(f"created {a.username} ({a.role})")


if __name__ == "__main__":
    main()
