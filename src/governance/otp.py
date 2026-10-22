"""Email verification, like Claude's: one email with a 6-digit code AND a one-click link, for sign-up and for
"forgot password".

Both are single-use and expire in 10 minutes; codes allow at most 5 wrong tries; using either uses both. Only hashes
are stored. Sent by SMTP when SMTP_HOST is set; otherwise written to the server log (local development only).
A sign-up also gets a wait token: the browser that started it is signed in once the email is verified anywhere."""
import hashlib
import hmac
import html
import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

log = logging.getLogger(__name__)
SCHEMA = """CREATE TABLE IF NOT EXISTS email_otp(username TEXT PRIMARY KEY, code_hash TEXT, expires_utc TEXT, tries INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS signup_waits(username TEXT PRIMARY KEY, token_hash TEXT, expires_utc TEXT, claimed INTEGER DEFAULT 0);"""
TTL, MAX_TRIES = timedelta(minutes=10), 5
# purpose -> (row key prefix, link route, subject, heading, button text, what it is for)
PURPOSES = {"signup": ("", "verify", "Your AiversePulse code", "Verify your email", "Verify and sign in", "sign up"),
            "reset": ("reset:", "reset", "Reset your AiversePulse password", "Reset your password", "Choose a new password",
                      "reset your password")}


def init(con):
    con.executescript(SCHEMA)
    if "link_hash" not in {r[1] for r in con.execute("PRAGMA table_info(email_otp)")}:
        with con:
            con.execute("ALTER TABLE email_otp ADD COLUMN link_hash TEXT")
    return con


def _h(key: str, secret: str) -> str:
    return hashlib.sha256(f"{key}:{secret}".encode()).hexdigest()


def issue(con, cfg, username: str, email: str, base_url: str, purpose: str = "signup") -> bool:
    """Create (or replace) the code and link, and send them. Returns True if it went out by email."""
    init(con)
    prefix, route, subject, heading, button, why = PURPOSES[purpose]
    key = prefix + username
    code, link_token = f"{secrets.randbelow(10 ** 6):06d}", secrets.token_urlsafe(24)
    with con:
        con.execute("INSERT OR REPLACE INTO email_otp(username,code_hash,expires_utc,tries,link_hash) VALUES(?,?,?,0,?)",
                    (key, _h(key, code), (datetime.now(timezone.utc) + TTL).isoformat(), _h(key, "link:" + link_token)))
    link = f"{base_url.rstrip('/')}/#/{route}/{username}/{link_token}"
    if not cfg.smtp_host:
        log.warning("SMTP not configured: %s code for %s is %s, link %s (development only)", purpose, username, code, link)
        return False
    msg = EmailMessage()
    msg["Subject"] = f"{subject}: {code}"
    msg["From"], msg["To"] = cfg.smtp_from or cfg.smtp_user, email
    msg.set_content(f"Your AiversePulse code is {code}\n\nOr use this link to {why}:\n{link}\n\n"
                    f"Both expire in 10 minutes. If you didn't try to {why}, you can ignore this email.")
    msg.add_alternative(f"""<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#1c2547">
<h2 style="margin:0 0 12px">{heading}</h2>
<p>Enter this code on the AiversePulse page:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:8px 0 20px">{code}</p>
<p>Or with one click:</p>
<p><a href="{html.escape(link)}" style="display:inline-block;background:#3b5bdb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">{button}</a></p>
<p style="color:#667;font-size:13px">Both expire in 10 minutes. If you didn't try to {why}, ignore this email.</p></div>""",
                    subtype="html")
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as s:
        s.starttls()
        if cfg.smtp_user:
            s.login(cfg.smtp_user, cfg.smtp_password.get_secret_value() if cfg.smtp_password else "")
        s.send_message(msg)
    return True


def _use(con, key: str, column: str, secret: str) -> bool:
    init(con)
    row = con.execute(f"SELECT {column}, expires_utc, tries FROM email_otp WHERE username=?", (key,)).fetchone()
    if not row or not row[0] or row[2] >= MAX_TRIES or datetime.fromisoformat(row[1]) < datetime.now(timezone.utc):
        return False
    ok = hmac.compare_digest(row[0], _h(key, secret))
    with con:
        if ok:  # code and link are one verification: using either one uses both
            con.execute("DELETE FROM email_otp WHERE username=?", (key,))
        else:
            con.execute("UPDATE email_otp SET tries=tries+1 WHERE username=?", (key,))
    return ok


def check(con, username: str, code: str, purpose: str = "signup") -> bool:
    return _use(con, PURPOSES[purpose][0] + username, "code_hash", (code or "").strip())


def check_link(con, username: str, token: str, purpose: str = "signup") -> bool:
    return _use(con, PURPOSES[purpose][0] + username, "link_hash", "link:" + (token or ""))


def new_wait(con, username: str) -> str:
    """For the browser that started the sign-up: once the email is verified anywhere (e.g. the link opened on a phone),
    that browser - and only that browser - picks up the signed-in session."""
    init(con)
    token = secrets.token_urlsafe(24)
    with con:
        con.execute("INSERT OR REPLACE INTO signup_waits VALUES(?,?,?,0)",
                    (username, hashlib.sha256(token.encode()).hexdigest(), (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()))
    return token


def wait_valid(con, username: str, token: str) -> bool:
    init(con)
    row = con.execute("SELECT token_hash, expires_utc, claimed FROM signup_waits WHERE username=?", (username,)).fetchone()
    return bool(row) and not row[2] and datetime.fromisoformat(row[1]) > datetime.now(timezone.utc) \
        and hmac.compare_digest(row[0], hashlib.sha256((token or "").encode()).hexdigest())


def claim_wait(con, username: str, token: str) -> bool:
    if not wait_valid(con, username, token):
        return False
    with con:
        con.execute("UPDATE signup_waits SET claimed=1 WHERE username=?", (username,))
    return True
