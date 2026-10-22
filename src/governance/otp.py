"""Email verification for sign-up, like Claude's: one email with a 6-digit code AND a one-click link.

Both are single-use and expire in 10 minutes; codes allow at most 5 wrong tries. Only hashes are stored. Sent by SMTP
when SMTP_HOST is set; otherwise written to the server log (local development only)."""
import hashlib
import hmac
import html
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
    if "link_hash" not in {r[1] for r in con.execute("PRAGMA table_info(email_otp)")}:
        with con:
            con.execute("ALTER TABLE email_otp ADD COLUMN link_hash TEXT")
    return con


def _h(username: str, secret: str) -> str:
    return hashlib.sha256(f"{username}:{secret}".encode()).hexdigest()


def issue(con, cfg, username: str, email: str, base_url: str) -> bool:
    """Create (or replace) the code and link, and send them. Returns True if it went out by email."""
    init(con)
    code, link_token = f"{secrets.randbelow(10 ** 6):06d}", secrets.token_urlsafe(24)
    with con:
        con.execute("INSERT OR REPLACE INTO email_otp(username,code_hash,expires_utc,tries,link_hash) VALUES(?,?,?,0,?)",
                    (username, _h(username, code), (datetime.now(timezone.utc) + TTL).isoformat(), _h(username, "link:" + link_token)))
    link = f"{base_url.rstrip('/')}/#/verify/{username}/{link_token}"
    if not cfg.smtp_host:
        log.warning("SMTP not configured: sign-up code for %s is %s, link %s (development only)", username, code, link)
        return False
    msg = EmailMessage()
    msg["Subject"] = f"Your AiversePulse code: {code}"
    msg["From"], msg["To"] = cfg.smtp_from or cfg.smtp_user, email
    msg.set_content(f"Your AiversePulse verification code is {code}\n\nOr verify and sign in with this link:\n{link}\n\n"
                    "Both expire in 10 minutes. If you didn't try to sign up, you can ignore this email.")
    msg.add_alternative(f"""<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#1c2547">
<h2 style="margin:0 0 12px">Verify your email</h2>
<p>Enter this code on the sign-up page:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:8px 0 20px">{code}</p>
<p>Or verify and sign in with one click:</p>
<p><a href="{html.escape(link)}" style="display:inline-block;background:#3b5bdb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Verify and sign in</a></p>
<p style="color:#667;font-size:13px">Both expire in 10 minutes. If you didn't try to sign up for AiversePulse, ignore this email.</p></div>""",
                    subtype="html")
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as s:
        s.starttls()
        if cfg.smtp_user:
            s.login(cfg.smtp_user, cfg.smtp_password.get_secret_value() if cfg.smtp_password else "")
        s.send_message(msg)
    return True


def _use(con, username: str, column: str, secret: str) -> bool:
    init(con)
    row = con.execute(f"SELECT {column}, expires_utc, tries FROM email_otp WHERE username=?", (username,)).fetchone()
    if not row or not row[0] or row[2] >= MAX_TRIES or datetime.fromisoformat(row[1]) < datetime.now(timezone.utc):
        return False
    ok = hmac.compare_digest(row[0], _h(username, secret))
    with con:
        if ok:  # code and link are one verification: using either one uses both
            con.execute("DELETE FROM email_otp WHERE username=?", (username,))
        else:
            con.execute("UPDATE email_otp SET tries=tries+1 WHERE username=?", (username,))
    return ok


def check(con, username: str, code: str) -> bool:
    return _use(con, username, "code_hash", (code or "").strip())


def check_link(con, username: str, token: str) -> bool:
    return _use(con, username, "link_hash", "link:" + (token or ""))
