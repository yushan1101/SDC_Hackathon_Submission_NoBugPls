"""Local accounts: scrypt password hashes, lockout after repeated failures, role-based access.

Roles: employee (plans for themself; sees plans HR made for their employee_id), hr_advisor
(team analysis, reviews pseudonymous employees), admin (account management via CLI).

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
USERNAME = re.compile(r"^[a-z0-9_.-]{3,40}$")


class AuthError(ValueError):
    pass


def init(con):
    con.executescript(SCHEMA)
    return con


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
    if len(password) < 10 or password.lower() == password or not re.search(r"\d", password):
        raise AuthError("password: >=10 chars with an uppercase letter and a digit")
    if role == "employee" and not employee_id:
        raise AuthError("employees need an employee_id (pseudonymous, e.g. E-001)")
    salt = os.urandom(16)
    with con:
        con.execute("INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc) VALUES(?,?,?,?,?,?,?)",
                    (username, _hash(password, salt), salt, role, employee_id, display_name or username, now()))


def authenticate(con, username: str, password: str, max_failures: int = 5, lock_minutes: int = 5) -> dict:
    init(con)
    username = (username or "").strip().lower()
    row = con.execute("SELECT pw_hash,salt,role,employee_id,display_name,failed,locked_until FROM users WHERE username=?",
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
