"""Email one-time codes for sign-up (like FixIt): 6 digits, stored hashed, 10 minutes, at most 5 tries.

Sent by SMTP when SMTP_HOST is set; otherwise written to the server log (local development only)."""
import hashlib
import hmac
import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

log = logging.getLogger(__name__)
SCHEMA = "CREATE TABLE IF NOT EXISTS email_otp(username TEXT PRIMARY KEY, code_hash TEXT, expires_utc TEXT, tries INTEGER DEFAULT 0);"
TTL, MAX_TRIES = timedelta(minutes=10), 5


def init(con):
    con.executescript(SCHEMA)
    return con


def _h(username: str, code: str) -> str:
    return hashlib.sha256(f"{username}:{code}".encode()).hexdigest()


def issue(con, cfg, username: str, email: str) -> bool:
    """Create (or replace) the code and send it. Returns True if it went out by email."""
    init(con)
    code = f"{secrets.randbelow(10 ** 6):06d}"
    with con:
        con.execute("INSERT OR REPLACE INTO email_otp VALUES(?,?,?,0)",
                    (username, _h(username, code), (datetime.now(timezone.utc) + TTL).isoformat()))
    if not cfg.smtp_host:
        log.warning("SMTP not configured: sign-up code for %s is %s (development only)", username, code)
        return False
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = "Your AiversePulse sign-up code", cfg.smtp_from or cfg.smtp_user, email
    msg.set_content(f"Your AiversePulse code is {code}. It expires in 10 minutes.\n\nIf you did not sign up, ignore this email.")
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as s:
        s.starttls()
        if cfg.smtp_user:
            s.login(cfg.smtp_user, cfg.smtp_password.get_secret_value() if cfg.smtp_password else "")
        s.send_message(msg)
    return True


def check(con, username: str, code: str) -> bool:
    init(con)
    row = con.execute("SELECT code_hash, expires_utc, tries FROM email_otp WHERE username=?", (username,)).fetchone()
    if not row or row[2] >= MAX_TRIES or datetime.fromisoformat(row[1]) < datetime.now(timezone.utc):
        return False
    ok = hmac.compare_digest(row[0], _h(username, (code or "").strip()))
    with con:
        if ok:
            con.execute("DELETE FROM email_otp WHERE username=?", (username,))
        else:
            con.execute("UPDATE email_otp SET tries=tries+1 WHERE username=?", (username,))
    return ok
