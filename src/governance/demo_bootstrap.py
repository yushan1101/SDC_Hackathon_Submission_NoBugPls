"""Create the fixed demo accounts once, through the protected setup route."""
import secrets

from governance import accounts
from governance.audit import now


DEMO_USERS = (
    ("demo_employee", "employee", "Demo Employee"),
    ("demo_hr", "hr_advisor", "Demo HR Advisor"),
    ("demo_admin", "admin", "Demo Administrator"),
)


def create_demo_accounts(con) -> list[dict[str, str]]:
    """Atomically create exactly these three accounts and return their passwords once."""
    names = [username for username, _, _ in DEMO_USERS]
    placeholders = ",".join("?" for _ in names)
    existing = [row[0] for row in con.execute(
        f"SELECT username FROM users WHERE username IN ({placeholders})", names
    )]
    if existing:
        raise accounts.AuthError("One or more demo accounts already exist; no accounts were changed.")

    employee_id = _new_employee_id(con)
    credentials = []
    for username, role, display_name in DEMO_USERS:
        credentials.append({
            "username": username,
            "role": role,
            "display_name": display_name,
            "employee_id": employee_id if role == "employee" else "",
            "password": f"Demo-{secrets.token_urlsafe(24)}7A",
        })

    # A single connection transaction prevents a partial set if any insert fails.
    with con:
        for item in credentials:
            salt = secrets.token_bytes(16)
            con.execute(
                "INSERT INTO users(username,pw_hash,salt,role,employee_id,display_name,created_utc) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    item["username"],
                    accounts._hash(item["password"], salt),
                    salt,
                    item["role"],
                    item["employee_id"] or None,
                    item["display_name"],
                    now(),
                ),
            )

    return [
        {"username": item["username"], "role": item["role"], "password": item["password"]}
        for item in credentials
    ]


def _new_employee_id(con) -> str:
    for _ in range(32):
        candidate = "U-" + secrets.token_hex(4)
        exists = con.execute(
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM users WHERE employee_id=?) "
            "OR EXISTS (SELECT 1 FROM plans WHERE subject_id=?)",
            (candidate, candidate),
        ).fetchone()
        if not exists:
            return candidate
    raise accounts.AuthError("Could not allocate a unique demo employee ID.")
