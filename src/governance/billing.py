"""Plans and payments: Stripe (test mode first) through its REST API, like the FixIt project.

Flow (Stripe Elements): POST /api/billing/intent creates a PaymentIntent for a plan -> the browser confirms it with the
card form (Stripe.js; card data never reaches this server) -> POST /api/billing/confirm re-reads the PaymentIntent from
Stripe and activates the plan only if Stripe says it succeeded, for this user, plan and amount. The signed webhook
(payment_intent.succeeded / .payment_failed) does the same as a backup; activation is idempotent per PaymentIntent.
"""
import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone

import httpx

from governance import accounts
from governance.audit import now

API = "https://api.stripe.com/v1"
SCHEMA = """
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, username TEXT, plan TEXT, amount_cents INTEGER, currency TEXT,
    intent_id TEXT UNIQUE, status TEXT, receipt_url TEXT, failure TEXT, created_utc TEXT, updated_utc TEXT);
"""
PLANS = {  # what each plan unlocks; prices come from settings so they can change without code
    "free": {"name": "Free", "for": "individual", "features": ["Quick Match", "AI trends", "3 new plans a month", "Read aloud"]},
    "pro": {"name": "Pro", "for": "individual", "features": ["Unlimited plans and chat", "Resume analysis", "AI mock interviews",
                                                           "Voice input in every browser", "PDF reports"]},
    "team": {"name": "Team", "for": "hr", "features": ["Team analysis and review queue", "Hiring with ranked screening",
                                                     "Auto-post jobs to LinkedIn, Facebook, X and more", "Ask your team data by voice or text",
                                                     "Choose the AI model per task", "Invite and manage your team"]},
}
PAID = {"pro", "team"}
FULL = {"pro", "team", "org"}  # plans with every individual feature


class BillingError(RuntimeError):
    pass


def init(con):
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript(SCHEMA)
    return con


def catalog(cfg) -> list[dict]:
    price = {"free": 0, "pro": cfg.price_pro_cents, "team": cfg.price_team_cents}
    return [{"id": k, **v, "price_cents": price[k], "currency": cfg.currency, "days": cfg.plan_days if k in PAID else None}
            for k, v in PLANS.items()]


def configured(cfg) -> bool:
    return bool(cfg.stripe_secret_key and cfg.stripe_publishable_key)


def _stripe(cfg, method: str, path: str, data: dict | None = None) -> dict:
    if not configured(cfg):
        raise BillingError("payments are not set up on this server")
    r = httpx.request(method, API + path, data=data, timeout=20,
                      headers={"Authorization": f"Bearer {cfg.stripe_secret_key.get_secret_value()}"})
    body = r.json()
    if r.status_code >= 400:
        raise BillingError(body.get("error", {}).get("message", "payment provider error"))
    return body


def price_of(cfg, plan: str) -> int:
    return {"pro": cfg.price_pro_cents, "team": cfg.price_team_cents}[plan]


def create_intent(con, cfg, user: dict, plan: str) -> dict:
    """A PaymentIntent for one plan period. The plan must suit the account: Pro for individuals, Team for HR."""
    init(con)
    if plan not in PAID:
        raise BillingError("choose Pro or Team")
    if (plan == "team") != (user["role"] == "hr_advisor"):
        raise BillingError("Team is for HR accounts; Pro is for individuals")
    acct = accounts.account(con, user["username"]) or {}
    amount = price_of(cfg, plan)
    pi = _stripe(cfg, "POST", "/payment_intents", {
        "amount": amount, "currency": cfg.currency, "automatic_payment_methods[enabled]": "true",
        "description": f"AiversePulse {PLANS[plan]['name']} ({cfg.plan_days} days)",
        "metadata[username]": user["username"], "metadata[plan]": plan,
        **({"receipt_email": acct["email"]} if acct.get("email") else {})})
    with con:
        con.execute("INSERT OR IGNORE INTO payments(username,plan,amount_cents,currency,intent_id,status,created_utc,updated_utc) "
                    "VALUES(?,?,?,?,?,?,?,?)", (user["username"], plan, amount, cfg.currency, pi["id"], pi["status"], now(), now()))
    return {"client_secret": pi["client_secret"], "intent_id": pi["id"], "publishable_key": cfg.stripe_publishable_key,
            "amount_cents": amount, "currency": cfg.currency}


def apply_intent(con, cfg, pi: dict, expected_user: str | None = None) -> dict:
    """Record a PaymentIntent's state; on success extend the plan once. Everything checked against Stripe's own data."""
    init(con)
    meta = pi.get("metadata") or {}
    username, plan = meta.get("username"), meta.get("plan")
    if expected_user and username != expected_user:
        raise BillingError("this payment belongs to another account")
    if plan not in PAID or not username:
        raise BillingError("not an AiversePulse plan payment")
    charge = pi.get("latest_charge") if isinstance(pi.get("latest_charge"), dict) else {}
    receipt = charge.get("receipt_url")
    ok = pi.get("status") == "succeeded" and pi.get("amount_received", pi.get("amount")) == price_of(cfg, plan) \
        and pi.get("currency") == cfg.currency
    with con:
        row = con.execute("SELECT status FROM payments WHERE intent_id=?", (pi["id"],)).fetchone()
        already = bool(row) and row[0] == "succeeded"
        if row:
            con.execute("UPDATE payments SET status=?, receipt_url=COALESCE(?,receipt_url), failure=?, updated_utc=? WHERE intent_id=?",
                        ("succeeded" if ok else pi.get("status"), receipt,
                         (pi.get("last_payment_error") or {}).get("message"), now(), pi["id"]))
        else:
            con.execute("INSERT INTO payments(username,plan,amount_cents,currency,intent_id,status,receipt_url,created_utc,updated_utc) "
                        "VALUES(?,?,?,?,?,?,?,?,?)", (username, plan, pi.get("amount"), pi.get("currency"), pi["id"],
                                                      "succeeded" if ok else pi.get("status"), receipt, now(), now()))
    if ok and not already:  # extend from today, or from the current end if still paid up
        a = accounts.account(con, username) or {}
        start = datetime.now(timezone.utc)
        if a.get("plan") == plan and a.get("plan_until") and datetime.fromisoformat(a["plan_until"]) > start:
            start = datetime.fromisoformat(a["plan_until"])
        accounts.set_plan(con, username, plan, (start + timedelta(days=cfg.plan_days)).isoformat())
    return {"status": "succeeded" if ok else pi.get("status"), "plan": plan, "activated": ok}


def confirm(con, cfg, user: dict, intent_id: str) -> dict:
    if not intent_id.startswith("pi_"):
        raise BillingError("invalid payment reference")
    pi = _stripe(cfg, "GET", f"/payment_intents/{intent_id}?expand[]=latest_charge")
    return apply_intent(con, cfg, pi, expected_user=user["username"])


def verify_webhook(payload: bytes, header: str | None, secret: str, tolerance: int = 300) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<payload>">; reject stale or unsigned events."""
    if not header or not secret:
        return False
    parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
    t = next((v for k, v in parts if k == "t"), None)
    sigs = [v for k, v in parts if k == "v1"]
    if not t or not t.isdigit() or not sigs or abs(time.time() - int(t)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


def payments(con, username: str | None = None, limit: int = 200) -> list[dict]:
    init(con)
    keys = ["username", "plan", "amount_cents", "currency", "intent_id", "status", "receipt_url", "failure", "created_utc"]
    sql = f"SELECT {','.join(keys)} FROM payments" + (" WHERE username=?" if username else "") + " ORDER BY created_utc DESC LIMIT ?"
    return [dict(zip(keys, r)) for r in con.execute(sql, ((username, limit) if username else (limit,)))]
