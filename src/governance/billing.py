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
CREATE TABLE IF NOT EXISTS subscriptions(owner TEXT PRIMARY KEY, customer_id TEXT, subscription_id TEXT UNIQUE, status TEXT,
    current_period_end TEXT, cancel_at_period_end INTEGER DEFAULT 0, amount_cents INTEGER, currency TEXT, updated_utc TEXT);
CREATE TABLE IF NOT EXISTS billing_meta(key TEXT PRIMARY KEY, value TEXT);
"""
SUB_VERSION = "2024-06-20"  # subscription calls pin a Stripe API version whose invoices still carry payment_intent
PLANS = {  # what each plan unlocks; prices come from settings so they can change without code
    "free": {"name": "Free", "for": "individual", "features": ["Quick Match", "AI trends", "3 new plans a month", "Read aloud"]},
    "pro": {"name": "Pro", "for": "individual", "features": ["Unlimited plans and chat", "Resume analysis", "AI mock interviews",
                                                           "Voice input in every browser", "PDF reports"]},
    "team": {"name": "Enterprise", "for": "hr", "monthly": True, "features": ["Monthly subscription, renews automatically",
                                                     "Employees or students in one organisation", "Team analysis and review queue", "Hiring with ranked screening",
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


def _stripe(cfg, method: str, path: str, data: dict | None = None, version: str | None = None) -> dict:
    if not configured(cfg):
        raise BillingError("payments are not set up on this server")
    headers = {"Authorization": f"Bearer {cfg.stripe_secret_key.get_secret_value()}"}
    if version:
        headers["Stripe-Version"] = version
    r = httpx.request(method, API + path, data=data, timeout=20, headers=headers)
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
        con.execute("INSERT INTO payments(username,plan,amount_cents,currency,intent_id,status,created_utc,updated_utc) "
                    "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", (user["username"], plan, amount, cfg.currency, pi["id"], pi["status"], now(), now()))
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
    pi = _stripe(cfg, "GET", f"/payment_intents/{intent_id}?expand[]=latest_charge&expand[]=invoice", version=SUB_VERSION)
    invoice = pi.get("invoice") if isinstance(pi.get("invoice"), dict) else None
    if invoice and invoice.get("subscription"):  # the first payment of an enterprise subscription
        return confirm_subscription(con, cfg, user, invoice["subscription"])
    return apply_intent(con, cfg, pi, expected_user=user["username"])


# ---------------------------------------------------------------- enterprise monthly subscription
def _product(con, cfg) -> str:
    """The one Stripe product the enterprise subscription is priced against (created once, then remembered)."""
    row = con.execute("SELECT value FROM billing_meta WHERE key='product_id'").fetchone()
    if row:
        return row[0]
    prod = _stripe(cfg, "POST", "/products", {"name": "AiversePulse Enterprise", "description": "Monthly enterprise subscription"})
    with con:
        con.execute("INSERT INTO billing_meta(key, value) VALUES('product_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (prod["id"],))
    return prod["id"]


def subscription(con, owner: str) -> dict | None:
    init(con)
    keys = ["owner", "customer_id", "subscription_id", "status", "current_period_end", "cancel_at_period_end", "amount_cents", "currency"]
    r = con.execute(f"SELECT {','.join(keys)} FROM subscriptions WHERE owner=?", (owner,)).fetchone()
    return dict(zip(keys, r)) if r else None


def _iso(ts) -> str | None:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat() if ts else None


def sync_subscription(con, cfg, sub: dict, expected_user: str | None = None) -> dict:
    """Record a Stripe subscription's state; while it is active the enterprise plan runs to the end of the paid month."""
    init(con)
    owner = (sub.get("metadata") or {}).get("username")
    if not owner or (sub.get("metadata") or {}).get("plan") != "team":
        raise BillingError("not an AiversePulse enterprise subscription")
    if expected_user and owner != expected_user:
        raise BillingError("this subscription belongs to another account")
    end = _iso(sub.get("current_period_end"))
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    amount = ((item.get("price") or {}).get("unit_amount")) or cfg.price_team_cents
    with con:
        con.execute("INSERT INTO subscriptions(owner,customer_id,subscription_id,status,current_period_end,cancel_at_period_end,amount_cents,currency,updated_utc) "
                    "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET customer_id=excluded.customer_id, subscription_id=excluded.subscription_id, "
                    "status=excluded.status, current_period_end=excluded.current_period_end, cancel_at_period_end=excluded.cancel_at_period_end, "
                    "amount_cents=excluded.amount_cents, currency=excluded.currency, updated_utc=excluded.updated_utc",
                    (owner, sub.get("customer"), sub["id"], sub.get("status"), end, int(bool(sub.get("cancel_at_period_end"))),
                     amount, sub.get("currency") or cfg.currency, now()))
    invoice = sub.get("latest_invoice") if isinstance(sub.get("latest_invoice"), dict) else None
    pi = invoice.get("payment_intent") if invoice and isinstance(invoice.get("payment_intent"), dict) else None
    if invoice and invoice.get("status") == "paid":
        ref = (pi or {}).get("id") or invoice["id"]  # one payments row per paid month
        with con:
            con.execute("INSERT INTO payments(username,plan,amount_cents,currency,intent_id,status,receipt_url,created_utc,updated_utc) "
                        "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET status=excluded.status, updated_utc=excluded.updated_utc",
                        (owner, "team", invoice.get("amount_paid"), invoice.get("currency"), ref, "succeeded",
                         invoice.get("hosted_invoice_url"), _iso(invoice.get("created")) or now(), now()))
    active = sub.get("status") in ("active", "trialing") and end
    if active:
        accounts.set_plan(con, owner, "team", end)
    elif sub.get("status") in ("canceled", "unpaid", "incomplete_expired"):
        accounts.set_plan(con, owner, "team", now())  # access ends now
    return {"status": sub.get("status"), "plan": "team", "activated": bool(active), "renews": end,
            "cancelling": bool(sub.get("cancel_at_period_end"))}


def subscribe(con, cfg, user: dict) -> dict:
    """Start the enterprise's monthly subscription; the browser pays the first invoice with Stripe Elements."""
    init(con)
    if user["role"] != "hr_advisor":
        raise BillingError("the enterprise subscription is for HR (organisation) accounts")
    cur = subscription(con, user["username"])
    if cur and cur["status"] in ("active", "trialing"):
        raise BillingError("your enterprise subscription is already active")
    acct = accounts.account(con, user["username"]) or {}
    customer = (cur or {}).get("customer_id") or _stripe(cfg, "POST", "/customers", {
        "name": acct.get("org_name") or acct.get("display_name") or user["username"], "metadata[username]": user["username"],
        **({"email": acct["email"]} if acct.get("email") else {})})["id"]
    sub = _stripe(cfg, "POST", "/subscriptions", {
        "customer": customer, "items[0][price_data][currency]": cfg.currency, "items[0][price_data][product]": _product(con, cfg),
        "items[0][price_data][unit_amount]": cfg.price_team_cents, "items[0][price_data][recurring][interval]": "month",
        "payment_behavior": "default_incomplete", "payment_settings[save_default_payment_method]": "on_subscription",
        "metadata[username]": user["username"], "metadata[plan]": "team", "expand[]": "latest_invoice.payment_intent"}, version=SUB_VERSION)
    sync_subscription(con, cfg, sub, expected_user=user["username"])
    pi = (sub.get("latest_invoice") or {}).get("payment_intent") or {}
    if not pi.get("client_secret"):
        raise BillingError("the payment provider did not return a payment to confirm")
    return {"client_secret": pi["client_secret"], "intent_id": pi["id"], "subscription_id": sub["id"],
            "publishable_key": cfg.stripe_publishable_key, "amount_cents": cfg.price_team_cents, "currency": cfg.currency, "monthly": True}


def confirm_subscription(con, cfg, user: dict, subscription_id: str) -> dict:
    if not subscription_id.startswith("sub_"):
        raise BillingError("invalid subscription reference")
    sub = _stripe(cfg, "GET", f"/subscriptions/{subscription_id}?expand[]=latest_invoice.payment_intent", version=SUB_VERSION)
    return sync_subscription(con, cfg, sub, expected_user=user["username"])


def set_renewal(con, cfg, user: dict, renew: bool) -> dict:
    cur = subscription(con, user["username"])
    if not cur or not cur["subscription_id"]:
        raise BillingError("there is no enterprise subscription")
    sub = _stripe(cfg, "POST", f"/subscriptions/{cur['subscription_id']}", {"cancel_at_period_end": "false" if renew else "true",
                                                                            "expand[]": "latest_invoice.payment_intent"}, version=SUB_VERSION)
    return sync_subscription(con, cfg, sub, expected_user=user["username"])


def on_subscription_event(con, cfg, obj: dict) -> None:
    """Webhook: invoice.paid / invoice.payment_failed / customer.subscription.updated|deleted -> re-read and record."""
    sub_id = obj.get("subscription") if obj.get("object") == "invoice" else obj.get("id")
    if not sub_id or not str(sub_id).startswith("sub_"):
        return
    sub = _stripe(cfg, "GET", f"/subscriptions/{sub_id}?expand[]=latest_invoice.payment_intent", version=SUB_VERSION)
    sync_subscription(con, cfg, sub)


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
