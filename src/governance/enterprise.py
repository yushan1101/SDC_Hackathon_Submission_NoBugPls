"""Enterprises and profiles.

An enterprise is an HR advisor's organisation: a company (its members are employees) or a school (its members are
students). It pays a flat monthly subscription (billing.subscribe), and the admin picks its AI model per task and reads
its monthly bill: subscription payments plus the AI usage of everyone in it.

Every account has a full profile (name, phone, title, department, photo); the photo lives in Cloudflare R2 (the fixit
bucket, under aiversepulse/avatars/), uploaded with a SigV4-signed PUT so no AWS library is needed.
"""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from governance import accounts

KINDS = {"company": ("Employee", "Employees"), "school": ("Student", "Students")}
PROFILE_FIELDS = {"display_name": 80, "phone": 30, "title": 80, "department": 80}
PHONE = re.compile(r"^[+()\d\s-]{6,30}$")
AVATAR_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
AVATAR_MAX = 2 * 1024 * 1024


class EnterpriseError(ValueError):
    pass


# ---------------------------------------------------------------- enterprise and member type
def owner_of(user: dict, acct: dict) -> str | None:
    """The enterprise an account belongs to: an HR advisor owns one; an invited member belongs to their inviter's."""
    return user["username"] if user["role"] == "hr_advisor" else acct.get("invited_by")


def kind_of(con, owner: str | None) -> str:
    row = con.execute("SELECT org_kind FROM users WHERE username=?", (owner,)).fetchone() if owner else None
    return row[0] if row and row[0] in KINDS else "company"


def member_label(con, owner: str | None, plural: bool = False) -> str:
    return KINDS[kind_of(con, owner)][1 if plural else 0]


# ---------------------------------------------------------------- profile
def profile(con, user: dict) -> dict:
    a = accounts.account(con, user["username"]) or {}
    owner = owner_of(user, a)
    org = con.execute("SELECT org_name, org_kind, display_name FROM users WHERE username=?", (owner,)).fetchone() if owner else None
    fields = {k: a.get(k) or "" for k in ("display_name", "email", "phone", "title", "department")}
    missing = [k for k in ("display_name", "email", "phone", "title", "department") if not fields[k]]
    return fields | {
        "avatar_url": f"/api/avatar/{user['username']}" if a.get("avatar_key") else None,
        "email_pending": a.get("email_pending") or None,
        "enterprise": ({"owner": owner, "name": (org[0] or org[2] or owner) if org else owner, "kind": kind_of(con, owner),
                        "member_label": member_label(con, owner), "members_label": member_label(con, owner, True)} if owner else None),
        "missing": missing, "complete": not missing,
    }


def update_profile(con, user: dict, data: dict) -> None:
    sets = {}
    for k, limit in PROFILE_FIELDS.items():
        if k in data and data[k] is not None:
            v = str(data[k]).strip()
            if len(v) > limit:
                raise EnterpriseError(f"{k.replace('_', ' ')} is too long")
            if k == "phone" and v and not PHONE.match(v):
                raise EnterpriseError("phone: digits, spaces, + ( ) and - only")
            if k == "display_name" and not v:
                raise EnterpriseError("name can't be empty")
            sets[k] = v
    if user["role"] == "hr_advisor":  # the enterprise itself
        if data.get("org_name") is not None:
            name = str(data["org_name"]).strip()
            if len(name) > 100:
                raise EnterpriseError("organisation name is too long")
            sets["org_name"] = name
        if data.get("org_kind") is not None:
            if data["org_kind"] not in KINDS:
                raise EnterpriseError("organisation type must be company or school")
            sets["org_kind"] = data["org_kind"]
    if not sets:
        return
    with con:
        con.execute(f"UPDATE users SET {', '.join(f'{k}=?' for k in sets)} WHERE username=?", (*sets.values(), user["username"]))


def start_email_change(con, username: str, new_email: str) -> str:
    """Remember the new address; the caller emails it a confirmation link (otp purpose 'email')."""
    new_email = new_email.strip().lower()
    if not accounts.EMAIL.match(new_email):
        raise EnterpriseError("enter a valid email address")
    if con.execute("SELECT 1 FROM users WHERE lower(email)=? AND username<>?", (new_email, username)).fetchone():
        raise EnterpriseError("that email is already used by another account")
    with con:
        con.execute("UPDATE users SET email_pending=? WHERE username=?", (new_email, username))
    return new_email


def finish_email_change(con, username: str) -> str:
    row = con.execute("SELECT email_pending FROM users WHERE username=?", (username,)).fetchone()
    if not row or not row[0]:
        raise EnterpriseError("no email change is waiting")
    if con.execute("SELECT 1 FROM users WHERE lower(email)=? AND username<>?", (row[0], username)).fetchone():
        raise EnterpriseError("that email is already used by another account")
    with con:
        con.execute("UPDATE users SET email=?, email_pending=NULL WHERE username=?", (row[0], username))
    return row[0]


# ---------------------------------------------------------------- Cloudflare R2 (S3 API, SigV4)
def r2_configured(cfg) -> bool:
    return bool((cfg.r2_endpoint or cfg.r2_account_id) and cfg.r2_access_key_id and cfg.r2_secret_access_key)


def _r2_host(cfg) -> str:
    """FixIt-style R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com) or an account id."""
    if cfg.r2_endpoint:
        return cfg.r2_endpoint.split("://", 1)[-1].strip("/").split("/")[0]
    return f"{cfg.r2_account_id}.r2.cloudflarestorage.com"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _r2(cfg, method: str, key: str, body: bytes = b"", content_type: str | None = None) -> httpx.Response:
    if not r2_configured(cfg):
        raise EnterpriseError("photo storage is not set up on this server")
    host = _r2_host(cfg)
    path = f"/{cfg.r2_bucket}/{quote(key)}"
    now = datetime.now(timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = f"{method}\n{path}\n\nhost:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n\n{signed}\n{payload}"
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    k = _sign(("AWS4" + cfg.r2_secret_access_key.get_secret_value()).encode(), day)
    for part in ("auto", "s3", "aws4_request"):
        k = _sign(k, part)
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {"x-amz-date": amz, "x-amz-content-sha256": payload,
               "Authorization": f"AWS4-HMAC-SHA256 Credential={cfg.r2_access_key_id}/{scope}, SignedHeaders={signed}, Signature={signature}"}
    if content_type:
        headers["Content-Type"] = content_type
    return httpx.request(method, f"https://{host}{path}", content=body, headers=headers, timeout=20)


def _sniff(data: bytes) -> str | None:
    """The real image type from the file's first bytes (never trust the browser's label)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def save_avatar(con, cfg, username: str, data: bytes) -> str:
    if len(data) > AVATAR_MAX:
        raise EnterpriseError("photo must be 2 MB or smaller")
    kind = _sniff(data)
    if not kind:
        raise EnterpriseError("photo must be a PNG, JPEG or WebP image")
    key = f"{cfg.r2_prefix}{username}-{secrets.token_hex(6)}.{AVATAR_TYPES[kind]}"
    r = _r2(cfg, "PUT", key, data, kind)
    if r.status_code >= 300:
        raise EnterpriseError("the photo could not be stored; try again")
    old = con.execute("SELECT avatar_key FROM users WHERE username=?", (username,)).fetchone()
    with con:
        con.execute("UPDATE users SET avatar_key=? WHERE username=?", (key, username))
    if old and old[0]:
        try:
            _r2(cfg, "DELETE", old[0])
        except (httpx.HTTPError, EnterpriseError):
            pass  # a stale old photo is harmless
    return key


def load_avatar(con, cfg, username: str) -> tuple[bytes, str] | None:
    row = con.execute("SELECT avatar_key FROM users WHERE username=?", (username,)).fetchone()
    if not row or not row[0] or not r2_configured(cfg):
        return None
    r = _r2(cfg, "GET", row[0])
    if r.status_code != 200:
        return None
    return r.content, r.headers.get("content-type", "image/png")


# ---------------------------------------------------------------- admin: enterprises, models, monthly bills
def _month_bounds(month: str | None) -> tuple[str, str, str]:
    now = datetime.now(timezone.utc)
    if month and re.fullmatch(r"\d{4}-\d{2}", month):
        y, m = map(int, month.split("-"))
    else:
        y, m = now.year, now.month
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc)
    return f"{y:04d}-{m:02d}", start.isoformat(), end.isoformat()


def _people(con, owner: str) -> list[str]:
    return [owner] + [r[0] for r in con.execute("SELECT username FROM users WHERE invited_by=? AND role='employee'", (owner,))]


def enterprises(con, cfg, month: str | None = None) -> dict:
    label, start, end = _month_bounds(month)
    out = []
    for owner, name, email, kind, plan, until in con.execute(
            "SELECT username, COALESCE(NULLIF(org_name,''), display_name, username), email, org_kind, plan, plan_until "
            "FROM users WHERE role='hr_advisor' ORDER BY username").fetchall():
        people = _people(con, owner)
        marks = ",".join("?" * len(people))
        usage = con.execute(f"SELECT COALESCE(SUM(calls),0), COALESCE(SUM(est_usd),0) FROM llm_usage WHERE username IN ({marks}) "
                            "AND at_utc>=? AND at_utc<?", (*people, start, end)).fetchone()
        paid = con.execute("SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE username=? AND plan='team' AND status='succeeded' "
                           "AND created_utc>=? AND created_utc<?", (owner, start, end)).fetchone()[0]
        sub = con.execute("SELECT status, current_period_end, cancel_at_period_end FROM subscriptions WHERE owner=?", (owner,)).fetchone()
        models = dict(con.execute("SELECT task, spec FROM org_models WHERE owner=?", (owner,)).fetchall())
        out.append({"owner": owner, "name": name, "email": email, "kind": kind if kind in KINDS else "company",
                    "members": len(people) - 1, "members_label": KINDS[kind if kind in KINDS else "company"][1],
                    "plan": accounts.effective_plan(plan, until), "plan_until": until,
                    "subscription": {"status": sub[0], "renews": sub[1], "cancelling": bool(sub[2])} if sub else None,
                    "monthly_fee_cents": cfg.price_team_cents, "paid_cents": paid, "currency": cfg.currency,
                    "ai_calls": usage[0], "ai_usd": round(usage[1], 4), "models": models})
    return {"month": label, "enterprises": out}


def usage(con, cfg, owner: str) -> dict:
    """This month's AI use for an enterprise against its allowance, plus its subscription: the HR usage ring."""
    label, start, end = _month_bounds(None)
    people = _people(con, owner)
    marks = ",".join("?" * len(people))
    calls, usd = con.execute(f"SELECT COALESCE(SUM(calls),0), COALESCE(SUM(est_usd),0) FROM llm_usage WHERE username IN ({marks}) "
                             "AND at_utc>=? AND at_utc<?", (*people, start, end)).fetchone()
    budget = cfg.enterprise_ai_budget_usd
    left = max(0.0, 1 - usd / budget) if budget else 1.0
    sub = con.execute("SELECT status, current_period_end, cancel_at_period_end FROM subscriptions WHERE owner=?", (owner,)).fetchone()
    days_left = (datetime.fromisoformat(end) - datetime.now(timezone.utc)).days + 1
    return {"month": label, "calls": calls, "ai_usd": round(usd, 4), "budget_usd": budget, "left_pct": round(100 * left),
            "resets_in_days": max(1, days_left), "people": len(people),
            "subscription": {"status": sub[0], "renews": sub[1], "cancelling": bool(sub[2])} if sub else None}


def bill(con, cfg, owner: str, month: str | None = None) -> dict:
    if not con.execute("SELECT 1 FROM users WHERE username=? AND role='hr_advisor'", (owner,)).fetchone():
        raise EnterpriseError("no such enterprise")
    label, start, end = _month_bounds(month)
    payments = [dict(zip(("date", "amount_cents", "currency", "status", "receipt_url"), r)) for r in con.execute(
        "SELECT created_utc, amount_cents, currency, status, receipt_url FROM payments WHERE username=? AND plan='team' "
        "AND created_utc>=? AND created_utc<? ORDER BY created_utc", (owner, start, end))]
    people = _people(con, owner)
    marks = ",".join("?" * len(people))
    usage = [dict(zip(("username", "calls", "tokens", "usd"), (u, c, t, round(d, 4)))) for u, c, t, d in con.execute(
        f"SELECT username, COALESCE(SUM(calls),0), COALESCE(SUM(input_tokens+output_tokens),0), COALESCE(SUM(est_usd),0) "
        f"FROM llm_usage WHERE username IN ({marks}) AND at_utc>=? AND at_utc<? GROUP BY username ORDER BY 4 DESC", (*people, start, end))]
    return {"owner": owner, "month": label, "currency": cfg.currency, "payments": payments,
            "subscription_paid_cents": sum(p["amount_cents"] or 0 for p in payments if p["status"] == "succeeded"),
            "usage": usage, "ai_usd": round(sum(u["usd"] for u in usage), 4), "ai_calls": sum(u["calls"] for u in usage)}


def set_model(con, owner: str, task: str, spec: str, tasks: dict, usable) -> None:
    if not con.execute("SELECT 1 FROM users WHERE username=? AND role='hr_advisor'", (owner,)).fetchone():
        raise EnterpriseError("no such enterprise")
    if task not in tasks:
        raise EnterpriseError("unknown task")
    with con:
        if not spec:
            con.execute("DELETE FROM org_models WHERE owner=? AND task=?", (owner, task))
            return
        if not con.execute("SELECT 1 FROM model_catalog WHERE spec=?", (spec,)).fetchone() or not usable(spec):
            raise EnterpriseError("that model is not in the catalog or has no key configured")
        con.execute("INSERT INTO org_models(owner, task, spec) VALUES(?,?,?) ON CONFLICT(owner, task) DO UPDATE SET spec=excluded.spec",
                    (owner, task, spec))
