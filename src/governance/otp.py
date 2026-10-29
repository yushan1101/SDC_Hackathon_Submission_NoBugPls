"""Email verification like Claude's: the email holds one link and no code.

The browser that started the flow (sign-up, "forgot password") keeps a wait token. Opening the link where that
token is (same browser, any tab) carries on right there. Opening it anywhere else (a phone, another browser) uses up
the link and shows a 6-digit code to type into the browser that started; nothing is signed in on the other device.
HR invites ("invite") have no starting browser: the link opens the "set your password" page.

Links and codes are single-use (using one uses both), expire (10 minutes; invites 7 days) and allow at most 5 wrong
code tries. Only hashes are stored."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from governance import mailer

SCHEMA = """CREATE TABLE IF NOT EXISTS email_otp(username TEXT PRIMARY KEY, code_hash TEXT, expires_utc TEXT, tries INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS signup_waits(username TEXT PRIMARY KEY, token_hash TEXT, expires_utc TEXT, claimed INTEGER DEFAULT 0);"""
MAX_TRIES = 5
# purpose -> (row key prefix, link route, lifetime, subject, heading, lines, button)
PURPOSES = {
    "signup": ("", "verify", timedelta(minutes=10), "Verify your AiversePulse email", "Verify your email",
               ["Open this link in the browser where you signed up and you're in.",
                "On another device, it shows a 6-digit code to type in that browser instead."], "Verify email"),
    "reset": ("reset:", "reset", timedelta(minutes=10), "Reset your AiversePulse password", "Reset your password",
              ["Open this link in the browser where you asked for it to choose a new password.",
               "On another device, it shows a 6-digit code to type in that browser instead."], "Reset password"),
    "email": ("email:", "email", timedelta(minutes=30), "Confirm your new AiversePulse email", "Confirm your new email",
              ["Open this link to use this address for your AiversePulse account ({username}).",
               "Until you do, your account keeps its current email."], "Confirm email"),
    "invite": ("invite:", "invite", timedelta(days=7), "You're invited to AiversePulse", "Join your team on AiversePulse",
               ["{inviter} invited you to AiversePulse, your organisation's reskilling and career-planning space.",
                "Your username is {username}. Open the link to choose a password; no sign-up needed."], "Accept invite"),
}


def init(con):
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript(SCHEMA)
    if "link_hash" not in {r[1] for r in con.execute("PRAGMA table_info(email_otp)")}:
        with con:
            con.execute("ALTER TABLE email_otp ADD COLUMN link_hash TEXT")
    return con


def _h(key: str, secret: str) -> str:
    return hashlib.sha256(f"{key}:{secret}".encode()).hexdigest()


def _later(d: timedelta) -> str:
    return (datetime.now(timezone.utc) + d).isoformat()


def issue(con, cfg, username: str, email: str, base_url: str, purpose: str = "signup", inviter: str = "") -> bool:
    """Create (or replace) the link and email it. Returns True if it went out by email."""
    init(con)
    prefix, route, ttl, subject, heading, lines, button = PURPOSES[purpose]
    key, token = prefix + username, secrets.token_urlsafe(24)
    with con:  # no code yet: one is made only if the link is opened in another browser
        con.execute("INSERT INTO email_otp(username,code_hash,expires_utc,tries,link_hash) VALUES(?,NULL,?,0,?) "
                    "ON CONFLICT(username) DO UPDATE SET code_hash=excluded.code_hash, expires_utc=excluded.expires_utc, "
                    "tries=excluded.tries, link_hash=excluded.link_hash",
                    (key, _later(ttl), _h(key, "link:" + token)))
    link = f"{base_url.rstrip('/')}/#/{route}/{username}/{token}"
    lasts = "7 days" if ttl.days else f"{ttl.seconds // 60} minutes"
    return mailer.send(cfg, email, subject, heading, [t.format(inviter=inviter or "Your HR team", username=username) for t in lines],
                       button, link, f"The link works once and expires in {lasts}. If you weren't expecting this, ignore it.",
                       owl_state={"signup": "update", "reset": "reminder", "invite": "greeting", "email": "update"}[purpose])


def _row(con, key: str):
    init(con)
    row = con.execute("SELECT code_hash, link_hash, expires_utc, tries FROM email_otp WHERE username=?", (key,)).fetchone()
    return row if row and row[3] < MAX_TRIES and datetime.fromisoformat(row[2]) > datetime.now(timezone.utc) else None


def link_valid(con, username: str, token: str, purpose: str) -> bool:
    """Checks the link without using it up (e.g. to show who an invite is for)."""
    key = PURPOSES[purpose][0] + username
    row = _row(con, key)
    return bool(row and row[1]) and hmac.compare_digest(row[1], _h(key, "link:" + (token or "")))


def _done(con, key: str):
    with con:
        con.execute("DELETE FROM email_otp WHERE username=?", (key,))


def check(con, username: str, code: str, purpose: str = "signup") -> bool:
    key = PURPOSES[purpose][0] + username
    row = _row(con, key)
    if not row or not row[0]:
        return False
    if hmac.compare_digest(row[0], _h(key, (code or "").strip())):
        _done(con, key)
        return True
    with con:
        con.execute("UPDATE email_otp SET tries=tries+1 WHERE username=?", (key,))
    return False


def check_link(con, username: str, token: str, purpose: str = "signup") -> bool:
    if not link_valid(con, username, token, purpose):
        return False
    _done(con, PURPOSES[purpose][0] + username)
    return True


def code_for_other_browser(con, username: str, token: str, purpose: str) -> str | None:
    """The link was opened away from the starting browser: use up the link, return a fresh code (10 minutes) for the
    person to type there. None if the link is not valid."""
    if not link_valid(con, username, token, purpose):
        return None
    key, code = PURPOSES[purpose][0] + username, f"{secrets.randbelow(10 ** 6):06d}"
    with con:
        con.execute("UPDATE email_otp SET code_hash=?, link_hash=NULL, tries=0, expires_utc=? WHERE username=?",
                    (_h(key, code), _later(timedelta(minutes=10)), key))
    return code


def new_wait(con, username: str, purpose: str = "signup") -> str:
    """The starting browser's proof that it started this flow (kept in that browser's storage)."""
    init(con)
    token = secrets.token_urlsafe(24)
    with con:
        con.execute("INSERT INTO signup_waits(username,token_hash,expires_utc,claimed) VALUES(?,?,?,0) "
                    "ON CONFLICT(username) DO UPDATE SET token_hash=excluded.token_hash, expires_utc=excluded.expires_utc, claimed=0",
                    (PURPOSES[purpose][0] + username, hashlib.sha256(token.encode()).hexdigest(), _later(timedelta(hours=1))))
    return token


def wait_valid(con, username: str, token: str, purpose: str = "signup") -> bool:
    init(con)
    row = con.execute("SELECT token_hash, expires_utc, claimed FROM signup_waits WHERE username=?",
                      (PURPOSES[purpose][0] + username,)).fetchone()
    return bool(row) and not row[2] and datetime.fromisoformat(row[1]) > datetime.now(timezone.utc) \
        and hmac.compare_digest(row[0], hashlib.sha256((token or "").encode()).hexdigest())


def claim_wait(con, username: str, token: str, purpose: str = "signup") -> bool:
    if not wait_valid(con, username, token, purpose):
        return False
    with con:
        con.execute("UPDATE signup_waits SET claimed=1 WHERE username=?", (PURPOSES[purpose][0] + username,))
    return True
