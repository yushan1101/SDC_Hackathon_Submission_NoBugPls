"""Sift-style account protection: every sign-up, login and payment is an event, scored 0-100 from device and behaviour
signals (sent by web/js/risk.js) plus server-side velocity, with the reasons kept for the admin dashboard.

    allow  (< REVIEW): proceed
    review (>= REVIEW): proceed but flagged for an admin (a sign-up also needs admin approval)
    block  (>= BLOCK): refused with a generic message

IP addresses are stored only as salted hashes. Accounts an admin marks as trusted are always allowed.
"""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone

from governance.audit import now

REVIEW, BLOCK = 40, 70
SCHEMA = """
CREATE TABLE IF NOT EXISTS risk_events(id INTEGER PRIMARY KEY, at_utc TEXT, event TEXT, username TEXT, ip_hash TEXT,
    device_id TEXT, score INTEGER, decision TEXT, reasons TEXT, signals TEXT, outcome TEXT);
CREATE INDEX IF NOT EXISTS risk_events_at ON risk_events(at_utc);
CREATE TABLE IF NOT EXISTS risk_meta(k TEXT PRIMARY KEY, v TEXT);
"""
# throwaway inboxes (a small, well-known list; a sign-up from one is a strong spam signal)
DISPOSABLE = {"mailinator.com", "10minutemail.com", "guerrillamail.com", "guerrillamail.net", "tempmail.com", "temp-mail.org",
              "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "sharklasers.com", "maildrop.cc",
              "fakeinbox.com", "throwawaymail.com", "mintemail.com", "emailondeck.com", "moakt.com", "tempr.email"}


def init(con):
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript(SCHEMA)
    return con


def _salt(con) -> str:
    row = con.execute("SELECT v FROM risk_meta WHERE k='ip_salt'").fetchone()
    if row:
        return row[0]
    salt = os.urandom(16).hex()
    with con:
        con.execute("INSERT OR IGNORE INTO risk_meta VALUES('ip_salt', ?)", (salt,))
    return con.execute("SELECT v FROM risk_meta WHERE k='ip_salt'").fetchone()[0]


def ip_hash(con, ip: str | None) -> str:
    return hashlib.sha256((_salt(con) + (ip or "")).encode()).hexdigest()[:24]


def _since(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _count(con, sql: str, *args) -> int:
    return con.execute(sql, args).fetchone()[0]


def assess(con, event: str, username: str | None, ip: str | None, signals: dict | None, email: str | None = None) -> dict:
    """Score one event and record it. event: signup | login | login_failed | payment | payment_failed."""
    init(con)
    s = signals if isinstance(signals, dict) else {}
    device = str(s.get("device_id") or "")[:64]
    iph = ip_hash(con, ip)
    reasons: list[tuple[int, str]] = []
    add = lambda pts, why: reasons.append((pts, why))

    # device and behaviour (from the browser snippet)
    if not device:
        add(20, "no device signals (request did not come from the app)")
    if s.get("webdriver"):
        add(60, "automated browser (webdriver)")
    fill = s.get("fill_ms")
    if event in ("signup", "login") and isinstance(fill, (int, float)) and 0 <= fill < 1500:
        add(25, f"form completed in {int(fill)} ms")
    if event in ("signup", "login") and s.get("pastes", 0) and isinstance(fill, (int, float)) and fill < 4000:
        add(10, "password pasted into a form filled in seconds")

    # velocity and history (server side)
    if event == "signup":
        by_ip = _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='signup' AND ip_hash=? AND at_utc>?", iph, _since(24))
        by_dev = _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='signup' AND device_id=? AND device_id!='' AND at_utc>?",
                        device, _since(24 * 7))
        if by_ip >= 3:
            add(30, f"{by_ip} sign-ups from this network in 24 h")
        if by_dev >= 2:
            add(35, f"{by_dev} accounts already created on this device this week")
        domain = (email or "").rsplit("@", 1)[-1].lower()
        if domain in DISPOSABLE:
            add(30, f"disposable email domain ({domain})")
    if event in ("login", "login_failed") and username:
        fails = _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='login_failed' AND username=? AND at_utc>?", username, _since(1))
        if fails >= 3:
            add(20, f"{fails} failed logins for this account in the last hour")
        if _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='login_failed' AND ip_hash=? AND at_utc>?", iph, _since(1)) >= 10:
            add(30, "many failed logins from this network (password spraying)")
        if event == "login" and device and _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='login' AND username=?", username) \
                and not _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='login' AND username=? AND device_id=?", username, device):
            add(10, "first login from this device")
    if event in ("payment", "payment_failed") and username:
        failed = _count(con, "SELECT COUNT(*) FROM risk_events WHERE event='payment_failed' AND username=? AND at_utc>?", username, _since(24))
        if failed >= 3:
            add(40, f"{failed} failed payments in 24 h (card testing)")

    score = min(100, sum(p for p, _ in reasons))
    trusted = bool(username) and bool((con.execute("SELECT trusted FROM users WHERE username=?", (username,)).fetchone() or [0])[0])
    decision = "allow" if trusted else ("block" if score >= BLOCK else "review" if score >= REVIEW else "allow")
    kept = {k: s.get(k) for k in ("device_id", "tz", "lang", "screen", "platform", "touch", "webdriver", "fill_ms", "keys", "pastes")}
    with con:
        con.execute("INSERT INTO risk_events(at_utc,event,username,ip_hash,device_id,score,decision,reasons,signals) VALUES(?,?,?,?,?,?,?,?,?)",
                    (now(), event, username, iph, device, score, decision, json.dumps([w for _, w in reasons]), json.dumps(kept)))
    return {"score": score, "decision": decision, "reasons": [w for _, w in reasons], "trusted": trusted}


def score_of(con, username: str) -> int:
    """An account's risk: the highest score of its events in the last 30 days."""
    init(con)
    return _count(con, "SELECT COALESCE(MAX(score),0) FROM risk_events WHERE username=? AND at_utc>?", username, _since(24 * 30))
