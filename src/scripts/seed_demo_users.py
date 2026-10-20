"""Create demo accounts with random passwords, written to data/demo_users.local.txt (gitignored).

    python scripts/seed_demo_users.py
"""
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from governance.accounts import create_user, init  # noqa: E402
from governance.audit import connect  # noqa: E402
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

USERS = [("demo_employee", "employee", "E-001", "Demo Employee (E-001)"),
         ("demo_hr", "hr_advisor", None, "Demo HR Advisor")]

con = init(connect())
lines = []
for username, role, eid, name in USERS:
    if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        print(f"{username} exists; skipped")
        continue
    pw = "Demo-" + secrets.token_urlsafe(9) + "7A"
    create_user(con, username, pw, role, eid, name)
    lines.append(f"{username}\t{role}\t{pw}")
out = Path("data/demo_users.local.txt")
if lines:
    with out.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"created {len(lines)} demo accounts; credentials in {out}")
