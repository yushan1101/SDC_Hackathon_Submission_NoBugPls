"""Web API + static UI for AiversePulse (public) and AiversePulse Enterprise (HR).

    uvicorn server.api:app --port 8600            # then open http://localhost:8600 (public) or /enterprise

Streaming: POST /api/analyze and /api/team return Server-Sent Events. Agent progress is real (one event per
agent as it finishes). The report text is streamed only AFTER the Reviewer has verified its citations, so the
chat-style typing never shows an unverified claim.
"""
import contextvars
import hashlib
import json
import logging
import queue
import re
import secrets
import threading
import time
import uuid
from collections import OrderedDict
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request as HttpRequest, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from agents.gap_analyst import SCENARIO_NOTES
from agents.pathway import HOURS_PER_LEVEL
from agents.sdg import goal_meta, role_sdgs
from agents import catalog, criteria, llm, matcher, quiz, resume
from agents.knowledge import learning_resources, occupation, resolve_occupation, role_requirements, search_occupations
from config.settings import get_settings
from core import graph, screening
from core.state import Pathway, Profile, Request, Skill
from core.team_import import parse_team
from governance.employee_ids import allocate_ids
from core.usage import summarize
from governance import accounts, approval, billing, challenge, deletion, otp, plugins, recruiting, reviews, risk
from mcp_server import signals
from mcp_server.ingest import occupation_url
from validation.document_guard import fingerprint, fraud_signals, risk as doc_risk
from governance.audit import connect
from validation.revision import validate
from interview import service as interview_service, store as interview_store
from interview.schemas import InterviewAnswer, InterviewCreate, InterviewEnd, InterviewPause, InterviewPrefetch

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
cfg = get_settings()
db = challenge.init(otp.init(billing.init(risk.init(recruiting.init(accounts.init(connect(cfg.database_path)))))))
db.executescript("""CREATE TABLE IF NOT EXISTS llm_usage(id INTEGER PRIMARY KEY, at_utc TEXT, username TEXT, feature TEXT, node TEXT,
                        model TEXT, calls INTEGER, input_tokens INTEGER, output_tokens INTEGER, est_usd REAL);
                    CREATE INDEX IF NOT EXISTS llm_usage_at ON llm_usage(at_utc);
                    CREATE TABLE IF NOT EXISTS briefing_log(username TEXT, at_utc TEXT);""")  # token use; free-plan quota
DB_LOCK = threading.Lock()  # one sqlite connection shared across request threads
SESSION_IDLE = timedelta(minutes=30)
COOKIE = "ap_session"
RESULTS: "OrderedDict[str, dict]" = OrderedDict()  # plan_id -> last run, to re-validate edits (bounded)

with DB_LOCK:
    db.executescript("""CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT, role TEXT,
                        employee_id TEXT, display_name TEXT, expires_utc TEXT);
                        CREATE TABLE IF NOT EXISTS frontend_sites(origin TEXT PRIMARY KEY, label TEXT, added_by TEXT,
                        created_utc TEXT);
                        CREATE TABLE IF NOT EXISTS model_catalog(spec TEXT PRIMARY KEY, label TEXT, created_utc TEXT);
                        CREATE TABLE IF NOT EXISTS agent_log(username TEXT, agent TEXT, at_utc TEXT);
                        CREATE TABLE IF NOT EXISTS org_models(owner TEXT, task TEXT, spec TEXT, PRIMARY KEY(owner, task));
                        CREATE TABLE IF NOT EXISTS plan_progress(plan_id TEXT, item TEXT, done_utc TEXT,
                        PRIMARY KEY(plan_id, item));""")  # activities ticked off as done ("<days>:<skill>")
    interview_store.init(db)

app = FastAPI(title="AiversePulse", docs_url=None, redoc_url=None, openapi_url=None)

# --- frontends on other domains, all calling this one backend ----------------------------------------
# Allowed = CORS_ORIGINS in .env plus the sites an admin adds on the admin dashboard (frontend_sites).
_sites_cache: tuple[float, set] = (0.0, set())


def _frontends() -> set:
    global _sites_cache
    if time.monotonic() - _sites_cache[0] > 30:  # ponytail: 30 s cache, so a newly added site works within half a minute
        # its own connection, not DB_LOCK: this runs while callers already hold that lock (e.g. building email links)
        import sqlite3
        from contextlib import closing
        try:
            with closing(sqlite3.connect(cfg.database_path, timeout=5)) as c:
                rows = {r[0] for r in c.execute("SELECT origin FROM frontend_sites")}
        except sqlite3.Error:
            rows = _sites_cache[1]
        _sites_cache = (time.monotonic(), rows)
    return set(cfg.allowed_origins) | _sites_cache[1]


def _foreign_origin(request: HttpRequest) -> str | None:
    """The calling frontend's origin when it is an allowed site other than this backend, else None."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    own = f"{request.url.scheme}://{request.url.netloc}"
    return origin if origin and origin != own and origin in _frontends() else None


from fastapi.middleware.cors import CORSMiddleware  # noqa: E402


class SitesCORS(CORSMiddleware):
    def is_allowed_origin(self, origin: str) -> bool:
        return origin.rstrip("/") in _frontends()


app.add_middleware(SitesCORS, allow_origins=[], allow_credentials=True, allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["Content-Type", "X-AP", "Accept", "Authorization"], max_age=600)


# --- security -------------------------------------------------------------------------------------
@app.middleware("http")
async def headers(request: HttpRequest, call_next):
    if request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith("/api/"):
        if request.headers.get("x-ap") != "1":  # custom header => cross-site forms can't post (CSRF)
            return JSONResponse({"detail": "missing X-AP header"}, status_code=403)
        origin = (request.headers.get("origin") or "").rstrip("/")
        own = f"{request.url.scheme}://{request.url.netloc}"
        if origin and origin != own and origin not in _frontends():  # defence in depth behind CORS
            return JSONResponse({"detail": "origin not allowed"}, status_code=403)
    if request.url.path.startswith("/api/") and (token := _session_token(request)):
        llm.ORG_MODELS.set(_org_models(token))
    resp = await call_next(request)
    resp.headers.update({
        "Content-Security-Policy": f"default-src 'self'; script-src 'self' '{_assets()[2]}' https://js.stripe.com; style-src 'self' 'unsafe-inline' "
                                   "https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.stripe.com; "
                                   "frame-src https://js.stripe.com https://hooks.stripe.com; media-src 'self' blob:; "  # blob: the read-aloud voice
                                   f"connect-src 'self' https://api.stripe.com; frame-ancestors {cfg.frame_ancestors}; base-uri 'none'; form-action 'self'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(self), geolocation=()"})
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"  # revalidate (cheap 304 via ETag) so UI updates ship immediately
    return resp


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _session_token(request: HttpRequest) -> str | None:
    """The session cookie; or, for a frontend on another domain (where browsers may block third-party cookies),
    "Authorization: Bearer <token>"."""
    auth = request.headers.get("authorization", "")
    return (auth[7:].strip() if auth.lower().startswith("bearer ") else None) or request.cookies.get(COOKIE)  # explicit wins


def _org_models(token: str) -> dict:
    """{task: model} chosen by the signed-in person's organisation (empty: the admin defaults)."""
    with DB_LOCK:
        row = db.execute("SELECT s.username, s.role, u.invited_by FROM sessions s LEFT JOIN users u ON u.username=s.username "
                         "WHERE s.token_hash=?", (_hash(token),)).fetchone()
        owner = (row[0] if row[1] == "hr_advisor" else row[2]) if row else None
        return dict(db.execute("SELECT task, spec FROM org_models WHERE owner=?", (owner,)).fetchall()) if owner else {}


def _in_context(fn):
    """Run fn in a thread with this request's context (the organisation's model choices)."""
    ctx = contextvars.copy_context()
    return lambda *a, **k: ctx.run(fn, *a, **k)


def current_user(request: HttpRequest) -> dict:
    token = _session_token(request)
    if not token:
        raise HTTPException(401, "sign in required")
    now = datetime.now(timezone.utc)
    with DB_LOCK:
        row = db.execute("SELECT username, role, employee_id, display_name, expires_utc FROM sessions WHERE token_hash=?",
                         (_hash(token),)).fetchone()
        if not row or datetime.fromisoformat(row[4]) < now:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (_hash(token),))
            db.commit()
            raise HTTPException(401, "session expired")
        db.execute("UPDATE sessions SET expires_utc=? WHERE token_hash=?", ((now + SESSION_IDLE).isoformat(), _hash(token)))
        db.commit()
    return {"username": row[0], "role": row[1], "employee_id": row[2], "display_name": row[3]}


def need(role: str):
    def dep(user: dict = Depends(current_user)):
        if user["role"] != role:
            raise HTTPException(403, f"{role} only")
        return user
    return dep


def _plan(user: dict) -> str:
    with DB_LOCK:
        return (accounts.account(db, user["username"]) or {}).get("effective_plan", "org")


def paid_feature(role: str, plans: set, what: str):
    """role + a plan that includes the feature; 402 says what to buy."""
    def dep(user: dict = Depends(need(role))):
        if _plan(user) not in plans:
            raise HTTPException(402, f"{what} is part of {'Team' if plans == {'team', 'org'} else 'Pro'}. See plans to upgrade.")
        return user
    return dep


def _ip(request: HttpRequest) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")


def _record_usage(username: str, feature: str, records) -> None:
    """Token use per user, feature, agent and model, for the admin dashboard."""
    rows = [r for r in (records if isinstance(records, list) else [records]) if isinstance(r, dict)]
    rows = [r for r in rows if r.get("llm_calls") or r.get("input_tokens") or r.get("output_tokens")]
    if not rows:
        return
    with DB_LOCK, db:
        db.executemany("INSERT INTO llm_usage(at_utc,username,feature,node,model,calls,input_tokens,output_tokens,est_usd) VALUES(?,?,?,?,?,?,?,?,?)",
                       [(datetime.now(timezone.utc).isoformat(), username, feature, r.get("node", feature), r.get("model", ""),
                         int(r.get("llm_calls", 1)), int(r.get("input_tokens", 0)), int(r.get("output_tokens", 0)),
                         float(r.get("est_usd", 0.0))) for r in rows])


class Login(BaseModel):
    username: str = Field(max_length=254)  # or the email
    password: str = Field(max_length=200)
    risk: dict | None = None  # device/behaviour signals from web/js/risk.js (Sift-style)


@app.post("/api/login")
def login(body: Login, request: HttpRequest, response: Response):
    name = (body.username or "").strip().lower()
    try:
        with DB_LOCK:
            user = accounts.authenticate(db, body.username, body.password, cfg.login_max_failures, cfg.login_lock_minutes)
    except accounts.PendingEmail:  # right password, email never verified: a new code instead of a dead end
        with DB_LOCK:
            a = accounts.account(db, name)
            otp.issue(db, cfg, name, a["email"], _base_url(request))
            wait = otp.new_wait(db, name)
        return {"status": "pending_email", "username": name, "email": a["email"], "wait_token": wait}
    except accounts.AuthError as e:
        with DB_LOCK:
            risk.assess(db, "login_failed", name, _ip(request), body.risk)
        raise HTTPException(401, str(e))
    with DB_LOCK:
        verdict = risk.assess(db, "login", user["username"], _ip(request), body.risk)
    if verdict["decision"] == "block":
        raise HTTPException(403, "Sign-in was blocked for your account's safety. Contact support if this was you.")
    return _start_session(user, request, response)


def _start_session(user: dict, request: HttpRequest, response: Response) -> dict:
    token = secrets.token_urlsafe(32)
    with DB_LOCK:
        db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?)", (_hash(token), user["username"], user["role"],
                   user["employee_id"], user["display_name"],
                   (datetime.now(timezone.utc) + SESSION_IDLE).isoformat()))
        db.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite=cfg.cookie_samesite,
                        secure=request.url.scheme == "https" or cfg.cookie_samesite == "none",
                        max_age=int(SESSION_IDLE.total_seconds()) * 16)
    if _foreign_origin(request):  # a frontend on another domain keeps the token itself (sent as a Bearer header)
        return user | {"session_token": token}
    return user


@app.post("/api/logout")
def logout(request: HttpRequest, response: Response):
    if token := _session_token(request):
        with DB_LOCK:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (_hash(token),))
            db.commit()
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    with DB_LOCK:
        a = accounts.account(db, user["username"]) or {}
    return user | {k: a.get(k) for k in ("email", "status", "plan", "plan_until", "effective_plan", "account_type")} \
        | {"terms_version": a.get("terms_version"), "terms_current": accounts.TERMS_VERSION}


@app.post("/api/challenge")
def challenge_new():
    """A slider puzzle for sign-up (the gap's position is only in the image)."""
    with DB_LOCK:
        return challenge.issue(db)


class SolveIn(BaseModel):
    x: float = Field(ge=0, le=challenge.W)
    trail: list[list[float]] = Field(max_length=400)
    keyboard: bool = False
    device_id: str = Field(default="", max_length=64)


@app.post("/api/challenge/{cid}/verify")
def challenge_verify(cid: str, body: SolveIn):
    try:
        with DB_LOCK:
            return {"ok": True, "token": challenge.verify(db, cid[:40], body.x, body.trail, body.device_id, body.keyboard)}
    except challenge.ChallengeError as e:
        raise HTTPException(422, "Not quite. Drag the piece into the gap." if str(e) == "retry" else "Expired. Here's a new puzzle.")


def _base_url(request: HttpRequest) -> str:
    """Where links in emails point: the frontend the person is using (so "continue in this browser" finds what
    that site stored), else PUBLIC_URL, else this request's address (https behind Cloudflare)."""
    if front := _foreign_origin(request):
        return front
    if cfg.public_url:
        return cfg.public_url
    base = str(request.base_url).rstrip("/")
    return base.replace("http://", "https://", 1) if '"https"' in request.headers.get("cf-visitor", "") else base


class RegisterIn(BaseModel):
    accept_terms: bool = False                                # Terms of Use + Privacy Policy; required
    challenge_token: str = Field(default="", max_length=80)  # the slider pass; required
    username: str = Field(min_length=3, max_length=40)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=200)
    display_name: str = Field(default="", max_length=60)
    account_type: str = Field(pattern="^(individual|hr)$")
    risk: dict | None = None


@app.post("/api/register")
def register(body: RegisterIn, request: HttpRequest, response: Response):
    """Sign-up, scored like Sift: block -> refused; review -> an admin approves it first. With SMTP set up, the email is
    verified with a one-time code before the account can be used."""
    name = body.username.strip().lower()
    if not body.accept_terms:
        raise HTTPException(422, "Please accept the Terms of Use and Privacy Policy to create an account.")
    with DB_LOCK:  # the slider check cannot be skipped: no valid, unused pass from this device, no account
        if not challenge.consume(db, body.challenge_token, str((body.risk or {}).get("device_id") or "")):
            raise HTTPException(422, "Complete the slider check first.")
        verdict = risk.assess(db, "signup", name, _ip(request), body.risk, body.email)
    if verdict["decision"] == "block":
        raise HTTPException(403, "We couldn't create this account. If you think this is a mistake, contact support.")
    try:
        with DB_LOCK:
            r = accounts.register(db, body.username, body.email, body.password, body.account_type, body.display_name,
                                  verify_email=bool(cfg.smtp_host))
            if verdict["decision"] == "review" and r["status"] == "active":  # suspicious individual: a person checks first
                accounts.set_status(db, r["username"], "pending_approval")
                r["status"] = "pending_approval"
    except accounts.AuthError as e:
        raise HTTPException(422, str(e))
    if r["status"] == "pending_email":
        with DB_LOCK:
            otp.issue(db, cfg, r["username"], body.email.strip().lower(), _base_url(request))
            wait = otp.new_wait(db, r["username"])
        return {"status": "pending_email", "username": r["username"], "email": body.email.strip().lower(), "wait_token": wait}
    if r["status"] == "active":
        with DB_LOCK:
            user = accounts.account(db, r["username"])
        return {"status": "active", **_start_session(user, request, response)}
    return {"status": r["status"], "username": r["username"]}


class VerifyIn(BaseModel):
    username: str = Field(max_length=40)
    code: str = Field(min_length=6, max_length=6)


@app.post("/api/register/verify")
def register_verify(body: VerifyIn, request: HttpRequest, response: Response):
    name = body.username.strip().lower()
    with DB_LOCK:
        ok = otp.check(db, name, body.code)
        if not ok:
            raise HTTPException(422, "That code is wrong or expired. Request a new one.")
        status = accounts.email_verified(db, name)
        user = accounts.account(db, name)
    if status == "active":
        return {"status": "active", **_start_session(user, request, response)}
    return {"status": status, "username": name}


class ResendIn(BaseModel):
    username: str = Field(max_length=40)


@app.post("/api/register/resend")
def register_resend(body: ResendIn, request: HttpRequest):
    name = body.username.strip().lower()
    with DB_LOCK:
        a = accounts.account(db, name)
        if a and a["status"] == "pending_email":
            otp.issue(db, cfg, name, a["email"], _base_url(request))
    return {"ok": True}  # same answer either way: no account enumeration


class PollIn(BaseModel):
    username: str = Field(max_length=40)
    wait_token: str = Field(min_length=20, max_length=80)


@app.post("/api/register/poll")
def register_poll(body: PollIn, request: HttpRequest, response: Response):
    """The "check your email" screen asks every few seconds. Once the email is verified (code or link, any device),
    the browser that holds the wait token is signed in - once."""
    name = body.username.strip().lower()
    with DB_LOCK:
        if not otp.wait_valid(db, name, body.wait_token):
            raise HTTPException(404, "nothing to wait for")
        a = accounts.account(db, name) or {}
        if a.get("status") == "pending_email":
            return {"status": "pending_email"}
        otp.claim_wait(db, name, body.wait_token)
    if a.get("status") == "active":
        return {"status": "active", **_start_session(a, request, response)}
    return {"status": a.get("status")}


# ---------------------------------------------------------------- forgotten password (email link or code)
class ForgotIn(BaseModel):
    login: str = Field(min_length=3, max_length=254)   # username or email
    challenge_token: str = Field(default="", max_length=80)
    risk: dict | None = None


@app.post("/api/password/forgot")
def password_forgot(body: ForgotIn, request: HttpRequest):
    """Sends a reset link and code if the account exists. Same answer either way (no account enumeration); the
    slider pass is required so this cannot be used to flood inboxes."""
    with DB_LOCK:
        if not challenge.consume(db, body.challenge_token, str((body.risk or {}).get("device_id") or "")):
            raise HTTPException(422, "Complete the slider check first.")
        a = accounts.find_login(db, body.login)
        verdict = risk.assess(db, "password_reset", a["username"] if a else None, _ip(request), body.risk)
        wait = secrets.token_urlsafe(24)  # no account: a token that matches nothing, so the answer looks the same
        if a and a.get("email") and a["status"] not in ("disabled", "invited") and verdict["decision"] != "block":
            otp.issue(db, cfg, a["username"], a["email"], _base_url(request), purpose="reset")
            wait = otp.new_wait(db, a["username"], "reset")
    return {"ok": True, "wait_token": wait}


class ResetIn(BaseModel):
    login: str = Field(default="", max_length=254)      # with a code: what the person typed (username or email)
    username: str = Field(default="", max_length=40)    # with a link: from the link
    code: str = Field(default="", max_length=6)
    token: str = Field(default="", max_length=80)
    wait_token: str = Field(default="", max_length=80)  # with a link: only the browser that asked can use it
    password: str = Field(min_length=10, max_length=200)


@app.post("/api/password/reset")
def password_reset(body: ResetIn):
    with DB_LOCK:
        a = accounts.find_login(db, body.username or body.login)
        ok = bool(a) and (otp.wait_valid(db, a["username"], body.wait_token, "reset") and otp.check_link(db, a["username"], body.token, "reset")
                          if body.token else otp.check(db, a["username"], body.code, "reset"))
        if not ok:
            raise HTTPException(422, "That code or link is wrong or expired. Ask for a new one.")
        try:
            accounts.set_password(db, a["username"], body.password)
        except accounts.AuthError as e:
            raise HTTPException(422, str(e))
        db.execute("DELETE FROM sessions WHERE username=?", (a["username"],))  # signed out everywhere
        db.execute("DELETE FROM signup_waits WHERE username=?", ("reset:" + a["username"],))
        db.commit()
    return {"ok": True}


class EmailOpenIn(BaseModel):
    purpose: str = Field(pattern="^(signup|reset)$")
    username: str = Field(max_length=40)
    token: str = Field(min_length=20, max_length=80)
    wait_token: str = Field(default="", max_length=80)  # what this browser kept when it started the flow, if anything


@app.post("/api/email/open")
def email_open(body: EmailOpenIn, request: HttpRequest, response: Response):
    """The link from the email (like Claude's). In the browser that started (it holds the wait token): carry on here -
    sign-up verifies and signs in; reset goes on to "choose a new password". Anywhere else: the link is used up and
    a 6-digit code is shown, to be typed in the starting browser. Nothing is signed in on the other device."""
    name = body.username.strip().lower()
    with DB_LOCK:
        same = otp.wait_valid(db, name, body.wait_token, body.purpose)
        if not same:
            code = otp.code_for_other_browser(db, name, body.token, body.purpose)
            if not code:
                raise HTTPException(422, "This link is used or expired. Ask for a new one.")
            return {"same_browser": False, "code": code}
        if body.purpose == "reset":
            if not otp.link_valid(db, name, body.token, "reset"):
                raise HTTPException(422, "This link is used or expired. Ask for a new one.")
            return {"same_browser": True}
        if not otp.check_link(db, name, body.token):
            raise HTTPException(422, "This link is used or expired. Sign in, or ask for a new email.")
        status = accounts.email_verified(db, name)
        otp.claim_wait(db, name, body.wait_token)
        user = accounts.account(db, name)
    if status == "active":  # _start_session takes DB_LOCK itself
        return {"same_browser": True, "status": "active", **_start_session(user, request, response)}
    return {"same_browser": True, "status": status, "username": name}


# ---------------------------------------------------------------- invited organisation users
class InviteCheckIn(BaseModel):
    username: str = Field(max_length=40)
    token: str = Field(min_length=20, max_length=80)


def _invited(name: str, token: str) -> dict:
    a = accounts.account(db, name)
    if not a or a["status"] != "invited" or not otp.link_valid(db, name, token, "invite"):
        raise HTTPException(422, "This invite was used, withdrawn or has expired. Ask your HR advisor for a new one.")
    return a


@app.post("/api/invite/check")
def invite_check(body: InviteCheckIn):
    name = body.username.strip().lower()
    with DB_LOCK:
        a = _invited(name, body.token)
        hr = accounts.account(db, a["invited_by"] or "") or {}
    return {"username": name, "display_name": a["display_name"], "email": a["email"], "invited_by": hr.get("display_name") or a["invited_by"]}


class InviteAcceptIn(InviteCheckIn):
    password: str = Field(min_length=10, max_length=200)
    accept_terms: bool = False


@app.post("/api/invite/accept")
def invite_accept(body: InviteAcceptIn, request: HttpRequest, response: Response):
    if not body.accept_terms:
        raise HTTPException(422, "Please accept the Terms of Use and Privacy Policy to continue.")
    name = body.username.strip().lower()
    with DB_LOCK:
        _invited(name, body.token)
        try:
            accounts.accept_invite(db, name, body.password)
        except accounts.AuthError as e:
            raise HTTPException(422, str(e))
        otp.check_link(db, name, body.token, "invite")  # used up
        user = accounts.account(db, name)
    return {"status": "active", **_start_session(user, request, response)}  # outside the lock: it takes DB_LOCK


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=200)
    confirm: str = Field(max_length=20)  # the person types DELETE


@app.post("/api/account/delete")
def account_delete(body: DeleteAccountIn, response: Response, user: dict = Depends(current_user)):
    """Deletes the account and the person's own data (see governance/deletion.py and the Privacy Policy)."""
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(422, "Type DELETE to confirm.")
    with DB_LOCK:
        if not accounts.check_password(db, user["username"], body.password):
            raise HTTPException(403, "That password is not right.")
        try:
            result = deletion.delete_account(db, user["username"])
        except deletion.DeletionError as e:
            raise HTTPException(400, str(e))
    response.delete_cookie(COOKIE)
    log.info("account deleted on request (%s items)", sum(result.values()))
    return {"ok": True}


# ---------------------------------------------------------------- plans and payments (Stripe Elements, test mode)
@app.get("/api/legal")
def legal_meta():
    return {"support_email": cfg.support_email or None, "terms_version": accounts.TERMS_VERSION}


@app.get("/api/billing/plans")
def billing_plans():
    return {"plans": billing.catalog(cfg), "enabled": billing.configured(cfg), "publishable_key": cfg.stripe_publishable_key or None}


class IntentIn(BaseModel):
    plan: str = Field(pattern="^(pro|team)$")
    risk: dict | None = None


@app.post("/api/billing/intent")
def billing_intent(body: IntentIn, request: HttpRequest, user: dict = Depends(current_user)):
    with DB_LOCK:
        verdict = risk.assess(db, "payment", user["username"], _ip(request), body.risk)
    if verdict["decision"] == "block":
        raise HTTPException(403, "This payment was blocked for your account's safety. Contact support.")
    try:
        with DB_LOCK:
            return billing.create_intent(db, cfg, user, body.plan)
    except billing.BillingError as e:
        raise HTTPException(503 if not billing.configured(cfg) else 400, str(e))


class ConfirmIn(BaseModel):
    intent_id: str = Field(max_length=80)


@app.post("/api/billing/confirm")
def billing_confirm(body: ConfirmIn, request: HttpRequest, user: dict = Depends(current_user)):
    try:
        with DB_LOCK:
            r = billing.confirm(db, cfg, user, body.intent_id)
            if r["status"] in ("requires_payment_method", "canceled"):
                risk.assess(db, "payment_failed", user["username"], _ip(request), None)
            return r | {"me": accounts.account(db, user["username"])}
    except billing.BillingError as e:
        raise HTTPException(400, str(e))


@app.post("/api/billing/webhook")
async def billing_webhook(request: HttpRequest):
    """Stripe -> us (signed). Backup for /confirm: the plan is activated even if the browser closed after paying."""
    payload = await request.body()
    secret = cfg.stripe_webhook_secret.get_secret_value() if cfg.stripe_webhook_secret else ""
    if not billing.verify_webhook(payload, request.headers.get("stripe-signature"), secret):
        raise HTTPException(400, "bad signature")
    event = json.loads(payload)
    obj = event.get("data", {}).get("object", {})
    if event.get("type") in ("payment_intent.succeeded", "payment_intent.payment_failed") and obj.get("object") == "payment_intent":
        try:
            with DB_LOCK:
                billing.apply_intent(db, cfg, obj)
                if event["type"] == "payment_intent.payment_failed":
                    risk.assess(db, "payment_failed", (obj.get("metadata") or {}).get("username"), None, {"device_id": "stripe"})
        except billing.BillingError:
            pass  # not one of ours
    return {"received": True}


@app.get("/api/billing/payments")
def billing_payments(user: dict = Depends(current_user)):
    with DB_LOCK:
        return billing.payments(db, user["username"])


# ---------------------------------------------------------------- admin dashboard
def _since_days(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class SiteIn(BaseModel):
    origin: str = Field(min_length=8, max_length=200)
    label: str = Field(default="", max_length=60)


@app.get("/api/admin/sites")
def admin_sites(request: HttpRequest, user: dict = Depends(need("admin"))):
    with DB_LOCK:
        rows = db.execute("SELECT origin, label, added_by, created_utc FROM frontend_sites ORDER BY created_utc").fetchall()
    return {"backend": _backend_url(request), "from_env": cfg.allowed_origins,
            "plugin_redirects": {p: _oauth_return(request, p) for p in sorted(plugins.OAUTH)},
            "plugins_ready": plugins.available(cfg),
            "sites": [dict(zip(("origin", "label", "added_by", "created_utc"), r)) for r in rows]}


@app.post("/api/admin/sites")
def admin_site_add(body: SiteIn, user: dict = Depends(need("admin"))):
    from urllib.parse import urlparse
    u = urlparse(body.origin.strip())
    local = u.hostname in ("localhost", "127.0.0.1")
    if u.scheme not in ("https", "http") or (u.scheme == "http" and not local) or not u.hostname or u.path not in ("", "/") or u.query:
        raise HTTPException(422, "Enter the site's address only, e.g. https://jobs.example.com (https required).")
    origin = f"{u.scheme}://{u.netloc}".lower()
    with DB_LOCK, db:
        db.execute("INSERT OR REPLACE INTO frontend_sites VALUES(?,?,?,?)",
                   (origin, body.label.strip() or u.hostname, user["username"], datetime.now(timezone.utc).isoformat(timespec="seconds")))
    global _sites_cache
    _sites_cache = (0.0, set())  # takes effect now
    return {"origin": origin}


@app.delete("/api/admin/sites")
def admin_site_remove(origin: str, user: dict = Depends(need("admin"))):
    global _sites_cache
    with DB_LOCK, db:
        n = db.execute("DELETE FROM frontend_sites WHERE origin=?", (origin.rstrip("/").lower(),)).rowcount
    _sites_cache = (0.0, set())
    if not n:
        raise HTTPException(404, "not in the list (sites from CORS_ORIGINS are changed in .env)")
    return {"ok": True}


def _backend_url(request: HttpRequest) -> str:
    base = str(request.base_url).rstrip("/")
    return base.replace("http://", "https://", 1) if '"https"' in request.headers.get("cf-visitor", "") else base


@app.get("/api/admin/summary")
def admin_summary(user: dict = Depends(need("admin"))):
    with DB_LOCK:
        q = lambda sql, *a: db.execute(sql, a).fetchone()[0]
        return {
            "users": q("SELECT COUNT(*) FROM users WHERE role!='admin'"),
            "pending_approval": q("SELECT COUNT(*) FROM users WHERE status='pending_approval'"),
            "disabled": q("SELECT COUNT(*) FROM users WHERE status='disabled'"),
            "paid": q("SELECT COUNT(*) FROM users WHERE plan IN ('pro','team') AND plan_until>?", datetime.now(timezone.utc).isoformat()),
            "revenue_30d_cents": q("SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE status='succeeded' AND created_utc>?", _since_days(30)),
            "currency": cfg.currency,
            "tokens_30d": q("SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM llm_usage WHERE at_utc>?", _since_days(30)),
            "llm_calls_30d": q("SELECT COALESCE(SUM(calls),0) FROM llm_usage WHERE at_utc>?", _since_days(30)),
            "risk_blocked_7d": q("SELECT COUNT(*) FROM risk_events WHERE decision='block' AND at_utc>?", _since_days(7)),
            "risk_review_7d": q("SELECT COUNT(*) FROM risk_events WHERE decision='review' AND at_utc>?", _since_days(7)),
            "payments_enabled": billing.configured(cfg), "email_codes": bool(cfg.smtp_host)}


@app.get("/api/admin/users")
def admin_users(q: str = "", status: str = "", user: dict = Depends(need("admin"))):
    sql = f"SELECT {','.join(accounts.KEYS)} FROM users WHERE role!='admin'"
    args: list = []
    if q:
        sql += " AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)"
        args += [f"%{q[:60]}%"] * 3
    if status:
        sql += " AND status=?"
        args.append(status)
    with DB_LOCK:
        rows = [dict(zip(accounts.KEYS, r)) for r in db.execute(sql + " ORDER BY created_utc DESC LIMIT 300", args)]
        for r in rows:
            r["effective_plan"] = accounts.effective_plan(r["plan"], r["plan_until"])
            r["risk"] = risk.score_of(db, r["username"])
    return rows


class AdminStatusIn(BaseModel):
    status: str = Field(pattern="^(active|disabled|pending_approval)$")


@app.post("/api/admin/users/{username}/status")
def admin_set_status(username: str, body: AdminStatusIn, user: dict = Depends(need("admin"))):
    """Approve (active), disable or put back on hold. Disabling signs the account out everywhere."""
    try:
        with DB_LOCK:
            accounts.set_status(db, username, body.status)
            if body.status != "active":
                db.execute("DELETE FROM sessions WHERE username=?", (username,))
                db.commit()
            accounts._event(db, username, f"status set by admin {user['username']}")  # who changed it
    except accounts.AuthError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


class TrustIn(BaseModel):
    trusted: bool


@app.post("/api/admin/users/{username}/trust")
def admin_trust(username: str, body: TrustIn, user: dict = Depends(need("admin"))):
    with DB_LOCK, db:
        n = db.execute("UPDATE users SET trusted=? WHERE username=? AND role!='admin'", (int(body.trusted), username)).rowcount
    if not n:
        raise HTTPException(404, "no such account")
    return {"ok": True}


@app.get("/api/admin/usage")
def admin_usage(days: int = 30, user: dict = Depends(need("admin"))):
    since = _since_days(max(1, min(days, 365)))
    def group(col):
        return [dict(zip(["key", "calls", "input_tokens", "output_tokens", "est_usd"], r)) for r in db.execute(
            f"SELECT {col}, SUM(calls), SUM(input_tokens), SUM(output_tokens), ROUND(SUM(est_usd),4) FROM llm_usage WHERE at_utc>? "
            f"GROUP BY {col} ORDER BY SUM(input_tokens+output_tokens) DESC LIMIT 50", (since,))]
    with DB_LOCK:
        return {"by_user": group("username"), "by_model": group("model"), "by_agent": group("node"), "by_feature": group("feature"),
                "by_day": group("substr(at_utc,1,10)")}


@app.get("/api/admin/risk")
def admin_risk(days: int = 7, decision: str = "", user: dict = Depends(need("admin"))):
    keys = ["at_utc", "event", "username", "ip_hash", "device_id", "score", "decision", "reasons", "signals"]
    sql = f"SELECT {','.join(keys)} FROM risk_events WHERE at_utc>?"
    args: list = [_since_days(max(1, min(days, 90)))]
    if decision:
        sql += " AND decision=?"
        args.append(decision)
    with DB_LOCK:
        rows = [dict(zip(keys, r)) for r in db.execute(sql + " ORDER BY at_utc DESC LIMIT 300", args)]
    for r in rows:
        r["reasons"], r["signals"] = json.loads(r["reasons"] or "[]"), json.loads(r["signals"] or "{}")
    return rows


@app.get("/api/admin/payments")
def admin_payments(user: dict = Depends(need("admin"))):
    with DB_LOCK:
        return billing.payments(db)


@app.get("/api/meta")
def meta(user: dict = Depends(current_user)):
    from agents.knowledge import snapshot
    return {"occupations": len(snapshot()["occupations"]), "scenarios": SCENARIO_NOTES,
            "outlook": _outlook_meta(),
            "llm": llm.model_for("coach") or None if cfg.llm_enabled else None,
            "voice": bool(llm.stt_model()) and _plan(user) in VOICE_PLANS,  # server speech-to-text for this account
            "tts": bool(llm.tts_model())}  # read-aloud and the interviewer use the server voice


# --- serialisation ----------------------------------------------------------------------------------
OWL = {"supervisor": "searching", "profiler": "analyzing", "knowledge_search": "analyzing",
       "gap_analysis": "analyzing", "market_analyst": "update", "pathway": "update", "coach": "thinking"}


def describe(node: str, u: dict) -> str:
    if node == "supervisor":
        return f"Routed as {u.get('route')} — {u.get('route_reason')}"
    if node == "profiler":
        return f"Profiled {len(u.get('levels', {}))} skills"
    if node == "knowledge_search":
        n = len(u.get("evidence", [])) + len(u.get("trend_evidence", []))
        title = u.get("retrieval", {}).get("title", "")
        return f"Loaded ESCO requirements for {title}: {len(u.get('requirements', {}))} skills, {n} sources"
    if node == "gap_analysis":
        return f"Scored {sum(g.gap > 0 for g in u.get('skill_gaps', []))} gaps under both AI scenarios"
    if node == "market_analyst":
        o, sig = u.get("outlook") or {}, u.get("signals")
        moving = [d["direction"] for d in o.values() if d["direction"] != "stable"]
        parts = [f"STF-KAN: {moving.count('rising')} rising, {moving.count('falling')} falling" if o else "STF-KAN asset unavailable",
                 f"trend board {sig['day']}: emergence {sig.get('emergence', 0):+.2f}, pressure {sig.get('pressure', 0):.2f}" if sig else "no trend board yet",
                 f"SDG {', '.join(str(x['goal']) for x in u.get('sdgs', []))}" if u.get("sdgs") else ""]
        return " · ".join(p for p in parts if p)
    if node == "pathway":
        p = u.get("draft_pathway")
        return f"Drafted {len(p.activities)} activities across 90 days" if p else "Drafted plan"
    if node == "coach":
        return "Wrote summary (" + ("AI" if u.get("narrative_mode") == "llm" else "template") + ")"
    if node == "reviewer":
        return f"Verified citations and workload · {u.get('revision_count', 0)} repairs"
    if node == "simple_lookup":
        return "Looked up ESCO facts"
    return node


def serialise(s: dict) -> dict:
    p = s.get("draft_pathway")
    reqs, outlook = s.get("requirements", {}), s.get("outlook", {})
    return {"route": s.get("route"), "route_reason": s.get("route_reason"), "answer": s.get("answer"),
            "status": s.get("status"), "narrative": s.get("narrative", ""), "narrative_mode": s.get("narrative_mode"),
            "occupation": s.get("occupation", {}),
            "gaps": [g.model_dump() | {"hot": bool(reqs.get(g.skill_id, {}).get("hot")),
                                       "outlook": outlook.get(g.skill_id, {}).get("direction")}
                     for g in s.get("skill_gaps", [])],
            "outlook": {"items": [{"skill_id": k, **v} for k, v in outlook.items() if v["direction"] != "stable"],
                        "model": _outlook_meta(), "forecast": s.get("forecast")} if outlook else None,
            "forecast": s.get("forecast"),  # live_cpu_inference | precomputed_asset | unavailable, with reason
            "comparison": s.get("scenario_comparison", []),
            "signals": s.get("signals"),
            "sdgs": [x | goal_meta(x["goal"]) for x in s.get("sdgs", [])],
            "evidence": [e.model_dump() for e in s.get("evidence", [])],
            "plan": p.model_dump() if p else None,
            "issues": [i.model_dump() for i in s.get("validation_issues", [])],
            "retrieval": s.get("retrieval", {}), "usage": summarize(s.get("usage", [])), "followup": s.get("followup"),
            "revision_count": s.get("revision_count", 0),
            "request": _request_dump(s.get("request"))}


def _request_dump(r) -> dict | None:
    if r is None:
        return None
    return {"target_role": r.target_role, "scenario": r.scenario, "query": r.query,
            "weekly_learning_hours": r.profile.weekly_learning_hours, "skills": [x.model_dump() for x in r.profile.skills]}


def _saved_thread(pid: str) -> list:
    """The conversation saved with a plan's report (oldest turn first); [] if none."""
    with DB_LOCK:
        row = db.execute("SELECT report FROM plan_reports WHERE plan_id=?", (pid,)).fetchone()
    if not row:
        return []
    r = json.loads(row[0])
    # reports saved before conversations were kept: their briefing is the first turn
    return r.get("thread") or ([{"q": None, "a": r.get("narrative") or r.get("answer") or "",
                                 "target_role": (r.get("occupation") or {}).get("soc"),
                                 "title": (r.get("occupation") or {}).get("title")}] if r.get("narrative") or r.get("answer") else [])


def _save_thread(pid: str, thread: list):
    """A question that changes no plan still belongs to the conversation: add it to the saved report."""
    with DB_LOCK, db:
        row = db.execute("SELECT report FROM plan_reports WHERE plan_id=?", (pid,)).fetchone()
        if row:
            db.execute("UPDATE plan_reports SET report=? WHERE plan_id=?",
                       (json.dumps(json.loads(row[0]) | {"thread": thread}, default=str), pid))


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def remember(pid: str, state: dict, thread: list | None = None):
    report = serialise(state) | ({"thread": thread} if thread is not None else {})
    with DB_LOCK, db:
        db.execute("INSERT OR REPLACE INTO plan_reports(plan_id, report) VALUES(?,?)",
                   (pid, json.dumps(report, default=str)))
    RESULTS[pid] = state
    RESULTS.move_to_end(pid)
    while len(RESULTS) > 1000:
        RESULTS.popitem(last=False)


def chunks(text: str, words: int = 3):
    parts = text.split(" ")
    for i in range(0, len(parts), words):
        yield " ".join(parts[i:i + words]) + (" " if i + words < len(parts) else "")


# --- public: streaming analysis ------------------------------------------------------------------------
class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    level: int = Field(ge=0, le=5)


class AnalyzeIn(BaseModel):
    target_role: str = Field(max_length=60)
    scenario: str = Field(pattern="^(assistive|agentic)$")
    weekly_learning_hours: float = Field(gt=0, le=80)
    skills: list[SkillIn] = Field(max_length=40)
    query: str = Field(default="Analyze my skill gaps and create a 30-60-90 day plan", max_length=500)
    previous_plan_id: str | None = Field(default=None, max_length=40)  # follow-up: reuse that run's unaffected agents


# --- individual mock interviews (isolated from the reskilling graph) -------------------------------------
# The first question is written while the person reads the set-up page (prefetch), so Start doesn't wait on the
# model. One prepared question per (person, recommendation, difficulty), used once, kept 15 minutes.
_PREPARE = ThreadPoolExecutor(max_workers=4)
_prepared: dict = {}
_prepared_lock = threading.Lock()


def _prepared_question(user: dict, recommendation: dict, difficulty: str, take: bool = False):
    key = (user["employee_id"], recommendation["recommendation_id"], difficulty)
    now = time.time()
    with _prepared_lock:
        for k in [k for k, (at, _) in _prepared.items() if now - at > 900]:
            _prepared.pop(k)
        at, job = _prepared.get(key) or (now, None)
        if job is None:
            def prepare(role_id, profile):
                prepared = interview_service.prepare_create(role_id, profile, difficulty)
                _speech(prepared[2]["text"])  # the interviewer's voice is ready when the room opens
                return prepared
            job = _PREPARE.submit(_in_context(prepare), recommendation["role_id"], recommendation["profile"])
            _prepared[key] = (at, job)
        if take:
            _prepared.pop(key, None)
    return job


def _interview_recommendation(recommendation_id: str, user: dict) -> dict:
    with DB_LOCK:
        recommendation = interview_store.recommendation(db, recommendation_id, user["employee_id"])
    if not recommendation:
        raise HTTPException(404, "Career recommendation not found.")
    if not resolve_occupation(recommendation["role_id"]):
        raise HTTPException(404, "The recommended role is no longer available.")
    return recommendation


@app.post("/api/interviews/prefetch")
def interview_prefetch(body: InterviewPrefetch, user: dict = Depends(paid_feature("employee", billing.FULL, "AI mock interviews"))):
    _prepared_question(user, _interview_recommendation(body.recommendation_id, user), body.difficulty)
    return {"ok": True}


@app.post("/api/interviews")
def interview_create(body: InterviewCreate, user: dict = Depends(paid_feature("employee", billing.FULL, "AI mock interviews"))):
    if not body.transcript_consent:
        raise HTTPException(422, "Consent is required to save interview answers and generate a personalized assessment.")
    recommendation = _interview_recommendation(body.recommendation_id, user)
    role_id, skills = recommendation["role_id"], recommendation["profile"]
    if body.plan_id:
        with DB_LOCK:
            if not approval.can_act(db, body.plan_id, user):
                raise HTTPException(404, "Plan not found.")
            planned = approval.latest(db, body.plan_id)["plan"]
            if resolve_occupation(planned.get("target_role", "")) != role_id:
                raise HTTPException(422, "Choose a learning plan for the same role.")
    try:
        interview_id, context, question = _prepared_question(user, recommendation, body.difficulty, take=True).result(timeout=90)
    except interview_service.InterviewError as e:
        raise HTTPException(e.status, e.message) from None
    with DB_LOCK, db:
        result = interview_service.persist_create(db, user["employee_id"], role_id, skills, body.difficulty,
                                                  body.plan_id, interview_id, context, question,
                                                  recommendation["recommendation_id"], recommendation["source"])
    return result


@app.get("/api/interview-recommendations/{recommendation_id}")
def interview_recommendation(recommendation_id: str, user: dict = Depends(need("employee"))):
    with DB_LOCK:
        recommendation = interview_store.recommendation(db, recommendation_id, user["employee_id"])
    if not recommendation:
        raise HTTPException(404, "Career recommendation not found.")
    return {key: value for key, value in recommendation.items() if key != "assessment_id"}


@app.get("/api/interviews")
def interview_history(user: dict = Depends(need("employee"))):
    with DB_LOCK:
        interviews = interview_store.history(db, user["employee_id"])
    total_stages = len(interview_service.STAGES)
    for item in interviews:
        item["question_number"] = min(total_stages, max(1, item["question_number"]))
        item["total_stages"] = total_stages
    return {"interviews": interviews}


@app.get("/api/interviews/{interview_id}")
def interview_detail(interview_id: str, user: dict = Depends(need("employee"))):
    with DB_LOCK:
        sess = interview_store.session(db, interview_id, user["employee_id"])
        if not sess:
            raise HTTPException(404, "Interview not found.")
        active = interview_store.question(db, sess["active_question_id"]) if sess["active_question_id"] else None
        report = interview_store.report(db, interview_id)
    return {"interview_id": interview_id, "role_id": sess["role_id"], "role_title": sess["role_title"],
            "difficulty": sess["difficulty"], "status": sess["status"], "stage_index": sess["stage_index"],
            "question": active, "report": report, "profile": sess["profile"], "plan_id": sess["plan_id"],
            "source": sess["context"]["source"], "assessment_source": sess.get("assessment_source"),
            "created_utc": sess["created_utc"],
            "question_number": min(len(interview_service.STAGES), max(1, sess["stage_index"] + 1)),
            "is_follow_up": bool(active and active["parent_question_id"]),
            "total_stages": len(interview_service.STAGES), "draft_answer": sess.get("draft_answer", ""),
            "asr": bool(llm.stt_model())}  # answers by voice go to the server speech model (STT_MODEL, e.g. MiMo)


@app.post("/api/interviews/{interview_id}/transcribe")
async def interview_transcribe(interview_id: str, file: UploadFile = File(...), lang: str = Form(""),
                               user: dict = Depends(need("employee"))):
    """A spoken interview answer -> text, with the server speech model. The audio is not stored."""
    with DB_LOCK:
        sess = interview_store.session(db, interview_id, user["employee_id"])
    if not sess or sess["status"] not in ("in_progress", "paused"):
        raise HTTPException(404, "Interview not found.")
    mime = (file.content_type or "").split(";")[0]
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, "Unsupported audio format.")
    audio = await file.read(10 * 1024 * 1024 + 1)
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(413, "That answer is too long to transcribe at once: keep it under 5 minutes.")
    if len(audio) < 800:
        raise HTTPException(422, "Nothing was recorded. Check your microphone and try again.")
    text, usage = await run_in_threadpool(llm.transcribe, audio, mime, lang[:10])
    if usage:
        _record_usage(user["username"], "interview-voice", usage)
    if text is None:
        raise HTTPException(503, "Transcription is unavailable right now. Please type your answer.")
    return {"text": text[:4000]}


@app.post("/api/interviews/{interview_id}/answer")
def interview_answer(interview_id: str, body: InterviewAnswer, user: dict = Depends(need("employee"))):
    answer_text = body.answer.strip()
    if not answer_text:
        raise HTTPException(422, "Enter an answer before continuing.")
    with DB_LOCK:
        sess = interview_store.session(db, interview_id, user["employee_id"])
        if not sess:
            raise HTTPException(404, "Interview not found.")
        if sess["status"] != "in_progress":
            raise HTTPException(409, "This interview is already complete.")
        if sess["active_question_id"] != body.question_id:
            raise HTTPException(409, "That is not the active question. Refresh the interview and try again.")
        current = interview_store.question(db, body.question_id)
        rows = db.execute("""SELECT q.question_text, q.stage, q.target_skills_json, r.answer_text
            FROM interview_questions q LEFT JOIN interview_responses r USING(question_id)
            WHERE q.interview_id=? ORDER BY q.sequence DESC LIMIT 6""", (interview_id,)).fetchall()
        transcript = [{"stage": r[1], "question": r[0], "target_skills": json.loads(r[2]), "answer": r[3]}
                      for r in reversed(rows) if r[3]]
    if not current:
        raise HTTPException(404, "Interview question not found.")
    try:
        prepared = interview_service.prepare_answer(sess, current, answer_text, transcript)
    except interview_service.InterviewError as e:
        raise HTTPException(e.status, e.message) from None
    with DB_LOCK, db:
        latest = interview_store.session(db, interview_id, user["employee_id"])
        if not latest or latest["active_question_id"] != body.question_id or latest["status"] != "in_progress":
            raise HTTPException(409, "This answer was already submitted. Refresh the interview.")
        result = interview_service.persist_answer(db, latest, current, answer_text, prepared)
    if (result.get("question") or {}).get("text"):
        _speech(result["question"]["text"])
    if result["status"] == "completed":
        report = result["report"]
        for recommendation in report.get("recommendations", [])[:3]:
            try:
                recommendation["resources"] = [item.model_dump() for item in learning_resources(recommendation["skill"], top_k=2)]
            except Exception:
                recommendation["resources"] = []
        with DB_LOCK, db:
            db.execute("UPDATE interview_reports SET report_json=? WHERE interview_id=?",
                       (interview_store.json_dump(report), interview_id))
    return result


@app.post("/api/interviews/{interview_id}/end")
def interview_end(interview_id: str, body: InterviewEnd, user: dict = Depends(need("employee"))):
    with DB_LOCK, db:
        sess = interview_store.session(db, interview_id, user["employee_id"])
        if not sess:
            raise HTTPException(404, "Interview not found.")
        if sess["status"] == "in_progress":
            interview_service.finish_without_answer(db, sess)
    return {"status": "ended"}


@app.post("/api/interviews/{interview_id}/pause")
def interview_pause(interview_id: str, body: InterviewPause, user: dict = Depends(need("employee"))):
    with DB_LOCK, db:
        sess = interview_store.session(db, interview_id, user["employee_id"])
        if not sess:
            raise HTTPException(404, "Interview not found.")
        if sess["status"] not in ("in_progress", "paused") or not sess["active_question_id"]:
            raise HTTPException(409, "This interview can no longer be paused.")
        db.execute("UPDATE interview_sessions SET status='paused', draft_answer=? WHERE interview_id=? AND employee_id=?",
                   (body.draft_answer.strip(), interview_id, user["employee_id"]))
    return {"status": "paused"}


@app.post("/api/interviews/{interview_id}/resume")
def interview_resume(interview_id: str, user: dict = Depends(need("employee"))):
    with DB_LOCK, db:
        sess = interview_store.session(db, interview_id, user["employee_id"])
        if not sess:
            raise HTTPException(404, "Interview not found.")
        if sess["status"] == "paused" and sess["active_question_id"]:
            db.execute("UPDATE interview_sessions SET status='in_progress' WHERE interview_id=? AND employee_id=?",
                       (interview_id, user["employee_id"]))
        elif sess["status"] != "in_progress" or not sess["active_question_id"]:
            raise HTTPException(409, "This interview cannot be resumed.")
    return {"status": "in_progress"}


@app.get("/api/interviews/{interview_id}/report")
def interview_report(interview_id: str, user: dict = Depends(need("employee"))):
    with DB_LOCK:
        if not interview_store.session(db, interview_id, user["employee_id"]):
            raise HTTPException(404, "Interview not found.")
        report = interview_store.report(db, interview_id)
    if not report:
        raise HTTPException(409, "A completed interview report is not available yet.")
    return report


@app.delete("/api/interviews/{interview_id}")
def interview_delete(interview_id: str, user: dict = Depends(need("employee"))):
    with DB_LOCK, db:
        if not interview_store.session(db, interview_id, user["employee_id"]):
            raise HTTPException(404, "Interview not found.")
        db.execute("DELETE FROM interview_reports WHERE interview_id=?", (interview_id,))
        db.execute("DELETE FROM interview_responses WHERE question_id IN (SELECT question_id FROM interview_questions WHERE interview_id=?)", (interview_id,))
        db.execute("DELETE FROM interview_questions WHERE interview_id=?", (interview_id,))
        db.execute("DELETE FROM interview_sessions WHERE interview_id=?", (interview_id,))
    return {"deleted": True}


AGENT_NAME = {"profiler": "Profiler", "knowledge_search": "Knowledge", "market_analyst": "Market analyst", "gap_analysis": "Gap analyst",
              "pathway": "Pathway", "coach": "Coach", "reviewer": "Reviewer"}


@app.post("/api/analyze")
def analyze(body: AnalyzeIn, user: dict = Depends(need("employee"))):
    try:
        soc = resolve_occupation(body.target_role)
        if not soc:
            raise HTTPException(422, "Unknown occupation: pick one from the ESCO search.")
        req = Request(request_id=uuid.uuid4().hex[:8], audience="individual", employee_id=user["employee_id"],
                      target_role=soc, scenario=body.scenario, query=body.query,
                      profile=Profile(weekly_learning_hours=body.weekly_learning_hours,
                                      skills=[Skill(name=s.name, level=s.level) for s in body.skills]))
    except ValidationError as e:
        raise HTTPException(422, str(e).splitlines()[0])

    if not body.previous_plan_id and _plan(user) == "free":
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        with DB_LOCK:
            used = db.execute("SELECT COUNT(*) FROM briefing_log WHERE username=? AND substr(at_utc,1,7)=?",
                              (user["username"], month)).fetchone()[0]
        if used >= cfg.free_monthly_briefings:
            raise HTTPException(402, f"You've used your {cfg.free_monthly_briefings} free briefings this month. "
                                     "Upgrade to Pro for unlimited briefings, or keep asking follow-up questions here.")
    if not body.previous_plan_id:
        with DB_LOCK, db:
            db.execute("INSERT INTO briefing_log VALUES(?,?)", (user["username"], datetime.now(timezone.utc).isoformat()))

    prev, history = None, []
    if body.previous_plan_id:  # only the caller's own run; if the server restarted, it falls back to a full run
        with DB_LOCK:
            mine = approval.can_act(db, body.previous_plan_id, user)
            if mine:
                prev = RESULTS.get(body.previous_plan_id)
        if mine:
            history = _saved_thread(body.previous_plan_id)

    asked = None if body.query == AnalyzeIn.model_fields["query"].default else body.query  # a typed message, not "make my plan"

    def gen():
        t0 = time.perf_counter()
        yield sse({"t": "owl", "state": "thinking", "say": "Reading your request"})
        final, ran = None, None  # ran = agents that ran on a follow-up (None = full briefing)
        try:
            # in a conversation (previous plan given) a vague follow-up refers to the plan; if the server lost that
            # run (restart), the briefing is rebuilt with the question instead of the message being rejected
            for kind, node, upd in (graph.stream_followup(prev, req) if prev else
                                   graph.stream(req, conversation=bool(body.previous_plan_id), question=asked if body.previous_plan_id else None)):
                if kind == "plan":
                    ran = set(upd["run"])
                    yield sse({"t": "plan", **upd, "label": f"Changed: {', '.join(upd['changed'])} · running " +
                               ", ".join(AGENT_NAME[n] for n in upd["run"])})
                elif kind == "reused":
                    yield sse({"t": "agent", "node": node, "reused": True, "label": f"{AGENT_NAME.get(node, node)}: reused, unaffected by this change",
                               "ms": round(1000 * (time.perf_counter() - t0))})
                elif kind == "update":
                    yield sse({"t": "agent", "node": node, "label": describe(node, upd),
                               "ms": round(1000 * (time.perf_counter() - t0))})
                    if node in OWL:
                        yield sse({"t": "owl", "state": OWL[node]})
                else:
                    final = upd
        except Exception:
            log.exception("analysis failed")
            yield sse({"t": "owl", "state": "confused", "say": "Something went wrong"})
            yield sse({"t": "error", "message": "The analysis failed. Please try again."})
            return
        out = serialise(final)
        _record_usage(user["username"], "briefing", final.get("usage", []))
        # the conversation so far plus this turn; q is None for the default "make my plan" request
        thread = history + [{"q": asked,
                             "a": out["narrative"] or out["answer"] or "", "target_role": req.target_role,
                             "title": (out["occupation"] or {}).get("title"),
                             "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}]
        pid = None
        if ran is not None and ran <= {"coach", "reviewer"}:
            pid = body.previous_plan_id  # a question changes no plan: keep answering about the same one
            _save_thread(pid, thread)
        elif out["route"] == "complex":
            with DB_LOCK:
                pid = approval.create(db, out["plan"], user["employee_id"], "individual", out["issues"])
            remember(pid, final, thread)
        with DB_LOCK:
            plan_reference = approval.reference(db, pid) if pid else None
        yield sse({"t": "meta", "route": out["route"], "status": out["status"], "plan_id": pid, "plan_reference": plan_reference,
                   "usage": out["usage"], "retrieval": out["retrieval"], "evidence": out["evidence"],
                   "target_role": req.target_role, "occupation": out["occupation"], "scenario": req.scenario})
        yield sse({"t": "owl", "state": "update", "say": "Writing your briefing"})
        for piece in chunks(out["narrative"] or out["answer"] or ""):
            yield sse({"t": "text", "delta": piece})
            time.sleep(0.03)  # presentation pacing of already-verified text
        # full briefing: every section. Follow-up: what changed, then only the sections whose agents re-ran.
        made_by = {"gaps": "gap_analysis", "comparison": "gap_analysis", "outlook": "market_analyst", "signals": "market_analyst",
                   "sdgs": "market_analyst", "plan": "pathway"}
        if ran is not None and out["followup"] and out["followup"]["changed"] != ["question"]:
            yield sse({"t": "section", "kind": "changes", "data": out["followup"]})
        for kind in ("gaps", "comparison", "outlook", "signals", "sdgs", "issues", "plan"):
            if ran is not None and kind in made_by and made_by[kind] not in ran:
                continue
            if out[kind]:
                yield sse({"t": "section", "kind": kind, "data": out[kind]})
                time.sleep(0.12)
        flagged = out["status"] == "flagged"
        yield sse({"t": "owl", "state": "confused" if flagged else "matched",
                   "say": "Needs a human fix before approval" if flagged else "Verified — ready for your review"})
        yield sse({"t": "done", "status": out["status"], "plan_id": pid})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- plans --------------------------------------------------------------------------------------------
def _guard(pid: str, user: dict):
    with DB_LOCK:
        if not approval.can_act(db, pid, user):
            raise HTTPException(404, "plan not found")


@app.get("/api/plans")
def plans(user: dict = Depends(current_user)):
    with DB_LOCK:
        rows = approval.list_plans(db, user)
        return [p | {"review": reviews.get(db, p["plan_id"])} for p in rows] if user["role"] == "hr_advisor" else rows


@app.get("/api/reviews")
def review_list(q: str = "", status: str = "active", user: dict = Depends(need("hr_advisor"))):
    if status not in {"active", "all", "pending", "approved", "rejected", "archived"}:
        raise HTTPException(422, "Invalid review status")
    term = q.strip().casefold()
    with DB_LOCK:
        rows = [p | {"review": reviews.get(db, p["plan_id"]), "progress": _progress_summary(
                    (approval.latest(db, p["plan_id"]) or {}).get("plan") or {},
                    db.execute("SELECT item, done_utc FROM plan_progress WHERE plan_id=?", (p["plan_id"],)).fetchall(),
                    p["created_utc"])} for p in approval.list_plans(db, user)]
    return [p for p in rows if (status == "all" or (p["review"]["archived"] if status == "archived" else
            not p["review"]["archived"] and (status == "active" or p["review"]["review_status"] == status)))
            and (not term or term in " ".join(str(x or "") for x in (
                p["subject_id"], p["target_role"], p.get("plan_reference"), p["plan_id"], p["review"]["candidate_name"],
                p["review"]["candidate_email"], p["review"]["candidate_phone"])).casefold())]


class ReviewEditIn(BaseModel):
    model_config = {"extra": "forbid"}
    employee_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,32}$")
    plan_reference: str | None = Field(default=None, pattern=r"^P[0-9]{6}$")
    candidate_name: str = Field(default="", max_length=120)
    candidate_email: str = Field(default="", max_length=254)
    candidate_phone: str = Field(default="", max_length=50)
    reviewer_notes: str = Field(default="", max_length=10000)
    review_status: str = Field(pattern="^(pending|approved|rejected)$")
    revision: int = Field(ge=0)


@app.post("/api/reviews/{pid}/edit")
def review_edit(pid: str, body: ReviewEditIn, user: dict = Depends(need("hr_advisor"))):
    _guard(pid, user)
    try:
        with DB_LOCK:
            return reviews.edit(db, pid, user, body.model_dump(exclude={"revision"}, exclude_none=True), body.revision)
    except approval.TransitionError as e:
        raise HTTPException(409, str(e))


class ReviewBulkIn(BaseModel):
    model_config = {"extra": "forbid"}
    plan_ids: list[str] = Field(min_length=1, max_length=50)
    action: str = Field(pattern="^(archive|restore|delete)$")
    confirmed: bool = False


@app.post("/api/reviews/bulk")
def review_bulk(body: ReviewBulkIn, user: dict = Depends(need("hr_advisor"))):
    try:
        with DB_LOCK:
            ids = reviews.bulk(db, body.plan_ids, user, body.action, body.confirmed)
            if body.action == "delete":
                for pid in ids:
                    RESULTS.pop(pid, None)
        return {"action": body.action, "count": len(ids)}
    except approval.TransitionError as e:
        raise HTTPException(409, str(e))


class DeletePlansIn(BaseModel):
    plan_ids: list[str] = Field(min_length=1, max_length=50)


@app.delete("/api/plans")
def delete_plans(body: DeletePlansIn, user: dict = Depends(need("employee"))):
    try:
        with DB_LOCK:
            deleted = approval.delete_employee_plans(db, body.plan_ids, user)
            for pid in deleted:
                RESULTS.pop(pid, None)
    except approval.TransitionError as e:
        raise HTTPException(404, str(e))
    return {"deleted": len(deleted), "plan_ids": deleted}


@app.get("/api/sdgs")
def sdgs(request: HttpRequest):
    """All 17 UN goals (public). Signed in: how often each goal appears across the person's own plans."""
    goals = [goal_meta(n) for n in range(1, 18)]
    try:
        user = current_user(request)
    except HTTPException:
        return {"goals": goals, "mine": None}
    count: dict[int, list[str]] = {}
    with DB_LOCK:
        for p in approval.list_plans(db, user):
            row = db.execute("SELECT report FROM plan_reports WHERE plan_id=?", (p["plan_id"],)).fetchone()
            for g in (json.loads(row[0]).get("sdgs") or []) if row else []:
                count.setdefault(g["goal"], []).append(p.get("target_title") or p.get("target_role") or p["plan_id"])
    return {"goals": goals, "mine": {str(k): sorted(set(v)) for k, v in count.items()}}


def _progress_summary(plan: dict, done_rows, created_utc: str) -> dict:
    """How far the employee has got with their 90-day plan: steps done (the boxes they tick), by phase, last activity,
    and the pace against how far into the 90 days they are."""
    acts = plan.get("activities", [])
    keys = {f"{a.get('day_range')}:{a.get('skill_id')}" for a in acts}
    done = {item: at for item, at in done_rows if item in keys}
    total, n = len(keys), len(done)
    phases = [{"days": d, "done": sum(f"{d}:{a.get('skill_id')}" in done for a in acts if a.get("day_range") == d),
               "total": sum(a.get("day_range") == d for a in acts)} for d in dict.fromkeys(a.get("day_range") for a in acts)]
    try:
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(created_utc.replace("Z", "+00:00"))).days
    except (AttributeError, ValueError):
        elapsed = 0
    share, expected = (n / total if total else 0), min(1.0, max(0, elapsed) / 90)
    pace = ("done" if total and n == total else "not_started" if n == 0 else
            "ahead" if share >= expected + 0.1 else "behind" if share < expected - 0.15 else "on_track")
    return {"done": n, "total": total, "pct": round(100 * share), "phases": phases, "last_utc": max(done.values(), default=None),
            "day": min(90, max(0, elapsed) + 1), "expected_pct": round(100 * expected), "pace": pace}


@app.get("/api/plans/{pid}")
def plan(pid: str, user: dict = Depends(current_user)):
    _guard(pid, user)
    with DB_LOCK:
        cur, hist = approval.latest(db, pid), approval.history(db, pid)
        audience = db.execute("SELECT audience, subject_id FROM plans WHERE plan_id=?", (pid,)).fetchone()
    with DB_LOCK:
        saved = db.execute("SELECT report FROM plan_reports WHERE plan_id=?", (pid,)).fetchone()
        done_rows = db.execute("SELECT item, done_utc FROM plan_progress WHERE plan_id=?", (pid,)).fetchall()
        done = [r[0] for r in done_rows]
        created = db.execute("SELECT created_utc FROM plans WHERE plan_id=?", (pid,)).fetchone()[0]
        review = {"review": reviews.get(db, pid), "review_history": reviews.history(db, pid),
                  "original_employee_id": (db.execute("SELECT original_id FROM plan_original_ids WHERE plan_id=?", (pid,))
                                           .fetchone() or [None])[0]} if user["role"] == "hr_advisor" else {}
    report = json.loads(saved[0]) if saved else serialise(RESULTS[pid]) if pid in RESULTS else None
    return {"plan_id": pid, "audience": audience[0], "subject_id": audience[1], **cur, "history": hist, "report": report,
            "progress": done, "progress_summary": _progress_summary(cur.get("plan") or {}, done_rows, created), **review}


class ProgressIn(BaseModel):
    item: str = Field(min_length=3, max_length=200)  # "<day range>:<skill>"
    done: bool


@app.post("/api/plans/{pid}/progress")
def plan_progress(pid: str, body: ProgressIn, user: dict = Depends(current_user)):
    _guard(pid, user)
    with DB_LOCK, db:
        if body.done:
            db.execute("INSERT OR REPLACE INTO plan_progress VALUES(?,?,?)", (pid, body.item, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))
        else:
            db.execute("DELETE FROM plan_progress WHERE plan_id=? AND item=?", (pid, body.item))
        done = [r[0] for r in db.execute("SELECT item FROM plan_progress WHERE plan_id=?", (pid,))]
    return {"progress": done}


class EditIn(BaseModel):
    activities: list[dict] = Field(max_length=60)


@app.post("/api/plans/{pid}/edit")
def edit(pid: str, body: EditIn, user: dict = Depends(current_user)):
    _guard(pid, user)
    with DB_LOCK:
        cur = approval.latest(db, pid)["plan"]
    try:
        new = Pathway(**{**cur, "activities": body.activities, "status": "draft"})
    except ValidationError as e:
        raise HTTPException(422, str(e).splitlines()[0])
    if s := RESULTS.get(pid):
        errs = [i.model_dump() for i in validate(new, s["skill_gaps"], {e.id for e in s["evidence"]},
                                                  s["request"].profile.weekly_learning_hours) if i.severity == "error"]
        if errs:
            return JSONResponse({"detail": "validation failed", "issues": errs}, status_code=422)
    role = "hr_advisor" if user["role"] == "hr_advisor" else "employee"
    with DB_LOCK:
        v = approval.edit(db, pid, new.model_dump(), user["username"], role)
    return {"version": v, "status": "draft"}


class ApproveIn(BaseModel):
    version: int
    confirmed: bool


class PlanStatusIn(ApproveIn):
    model_config = {"extra": "forbid"}
    status: str = Field(pattern="^(draft|flagged|approved)$")


@app.post("/api/plans/{pid}/status")
def change_plan_status(pid: str, body: PlanStatusIn, user: dict = Depends(need("hr_advisor"))):
    _guard(pid, user)
    try:
        with DB_LOCK:
            v = approval.change_status(db, pid, user, body.status, body.version, body.confirmed)
        return {"version": v, "status": body.status}
    except approval.TransitionError as e:
        raise HTTPException(409, str(e))


@app.post("/api/plans/{pid}/approve")
def approve(pid: str, body: ApproveIn, user: dict = Depends(current_user)):
    _guard(pid, user)
    role = "hr_advisor" if user["role"] == "hr_advisor" else "employee"
    try:
        with DB_LOCK:
            v = approval.approve(db, pid, body.version, user["username"], role, body.confirmed)
    except approval.TransitionError as e:
        raise HTTPException(409, str(e))
    return {"version": v, "status": "approved"}


@app.post("/api/plans/{pid}/acknowledge")
def acknowledge(pid: str, user: dict = Depends(need("employee"))):
    _guard(pid, user)
    try:
        with DB_LOCK:
            approval.acknowledge(db, pid, user)
    except approval.TransitionError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


# --- enterprise: streaming team analysis ----------------------------------------------------------------
class TeamIn(BaseModel):
    csv: str = Field(max_length=2_000_000)
    scenario: str = Field(pattern="^(assistive|agentic)$")


@app.post("/api/team/validate")
def team_validate(body: TeamIn, user: dict = Depends(need("hr_advisor"))):
    reqs, errs = _parse(body)
    return {"employees": len(reqs), "errors": errs}


def _parse(body: TeamIn):
    try:
        df = pd.read_csv(StringIO(body.csv))
    except Exception:
        return [], ["could not read CSV"]
    return parse_team(df, resolve_occupation, body.scenario, cfg.max_upload_rows, cfg.max_team_size)


@app.post("/api/team")
def team(body: TeamIn, user: dict = Depends(paid_feature("hr_advisor", {"team", "org"}, "Team analysis"))):
    reqs, errs = _parse(body)
    if errs:
        return JSONResponse({"detail": "invalid team file", "errors": errs}, status_code=422)

    with DB_LOCK:
        account_ids = [r[0] for r in db.execute("SELECT employee_id FROM users WHERE employee_id IS NOT NULL")]
        fresh_ids = allocate_ids(db, [r.employee_id for r in reqs], account_ids)
    original = {eid: r.employee_id for r, eid in zip(reqs, fresh_ids)}
    reqs = [r.model_copy(update={"employee_id": eid, "request_id": eid}) for r, eid in zip(reqs, fresh_ids)]

    def gen():
        yield sse({"t": "owl", "state": "searching", "say": f"Analysing {len(reqs)} employees in parallel"})
        agg, flagged = {}, []
        events: queue.Queue = queue.Queue()

        def worker(r):  # stream each employee's graph so the UI can tick its agent trace live
            try:
                final = None
                for kind, node, upd in graph.stream(r):
                    if kind == "update":
                        events.put(("agent", r, node))
                    else:
                        final = upd
                events.put(("final", r, final))
            except Exception:
                log.exception("team member run failed")
                events.put(("error", r, None))

        with ThreadPoolExecutor(max_workers=8) as pool:
            for r in reqs:
                pool.submit(_in_context(worker), r)
            yield sse({"t": "roster", "ids": [r.employee_id for r in reqs],
                       "roles": {r.employee_id: occupation(r.target_role)["title"] for r in reqs},
                       "original_ids": {o: eid for eid, o in original.items()}})
            remaining = len(reqs)
            while remaining:
                kind, r, payload = events.get()
                if kind == "agent":
                    yield sse({"t": "tick", "id": r.employee_id, "node": payload})
                    continue
                remaining -= 1
                if kind == "error":
                    yield sse({"t": "employee", "id": r.employee_id, "error": True})
                    continue
                s = payload
                out = serialise(s)
                with DB_LOCK:
                    pid = approval.create(db, out["plan"], r.employee_id, "hr", out["issues"])
                    with db:
                        db.execute("INSERT INTO plan_original_ids VALUES(?,?)", (pid, original[r.employee_id]))
                remember(pid, s)
                for g in s.get("skill_gaps", []):
                    if g.gap > 0:
                        a = agg.setdefault(g.skill_id, {"skill_id": g.skill_id, "employees_with_gap": 0,
                                                        "total_gap_levels": 0})
                        a["employees_with_gap"] += 1
                        a["total_gap_levels"] += g.gap
                if out["status"] == "flagged":
                    flagged.append(r.employee_id)
                yield sse({"t": "employee", "id": r.employee_id, "plan_id": pid, "role": occupation(r.target_role)["title"], "soc": r.target_role,
                           "hours": r.profile.weekly_learning_hours, "status": out["status"],
                           "top_gaps": [g["skill_id"] for g in out["gaps"] if g["gap"] > 0][:3],
                           "est_hours": sum(g["gap"] for g in out["gaps"]) * HOURS_PER_LEVEL})
                yield sse({"t": "needs", "data": sorted(agg.values(), key=lambda a: (-a["employees_with_gap"],
                                                                                     -a["total_gap_levels"]))})
        yield sse({"t": "owl", "state": "confused" if flagged else "celebrating",
                   "say": f"{len(flagged)} flagged for manual review" if flagged else "All drafts ready for review"})
        yield sse({"t": "done", "flagged": flagged})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


DEMO_ROLE = "nurse responsible for general care"


@app.get("/api/public/specimen")
def specimen(soc: str = ""):
    """Real, public ESCO example for the sign-in page (no auth): most important skills for one occupation."""
    soc = soc if occupation(soc) else resolve_occupation(DEMO_ROLE)
    o = occupation(soc)
    top = sorted(o["skills"].items(), key=lambda kv: -kv[1]["importance"])[:5]
    return {"role": o["title"], "skills": [[k, v["importance"]] for k, v in top], "unit": "predicted importance (1-5)",
            "source": "ESCO v1.2 (European Commission); importance predicted by a model trained on O*NET ratings",
            "url": occupation_url(o)}


@app.get("/api/occupations")
def occupations(q: str = "", limit: int = 12, user: dict = Depends(current_user)):
    return {"results": search_occupations(q[:80], max(1, min(limit, 30)))}


@app.get("/api/occupations/{soc}")
def occupation_detail(soc: str, user: dict = Depends(current_user)):
    o = occupation(soc)
    if not o:
        raise HTTPException(404, "occupation not found")
    return {"soc": soc, "title": o["title"], "description": o["description"], "job_zone": o["job_zone"],
            "skills": [{"name": k, "importance": v["importance"], "required": v["required"]} for k, v in o["skills"].items()],
            "tools": o["tech"], "url": occupation_url(o), "isco": o.get("isco")}


def _outlook_meta():
    from mcp_server.server import OUTLOOK, _outlook_asset
    return _outlook_asset(OUTLOOK.stat().st_mtime)["model"] if OUTLOOK.exists() else None


class ForecastIn(BaseModel):
    role_id: str = Field(min_length=1, max_length=200)


@app.post("/api/forecasts")
def forecasts(body: ForecastIn, user: dict = Depends(current_user)):
    """Blueprint section 7: gated STF-KAN outlook for one occupation (ESCO code or title). Unavailable -> reason."""
    from mcp_server.server import skill_outlook
    soc = resolve_occupation(body.role_id)
    if not soc:
        return {"role_id": body.role_id, "forecast": {"status": "unavailable", "reason": "not an ESCO occupation"}, "outlook": {}}
    r = getattr(skill_outlook, "fn", skill_outlook)(soc)
    return {"role_id": soc, "forecast": r["forecast"], "outlook": r["outlook"]}


@app.get("/api/sample-team")
def sample_team(user: dict = Depends(need("hr_advisor"))):
    return {"csv": (ROOT / "data" / "samples" / "sample_team.csv").read_text(encoding="utf-8")}


# --- AI-trend signals (daily board) ----------------------------------------------------------------------
def _board_summary(b: dict | None) -> dict:
    if not b:
        return {"available": False, "message": "No trend board yet. HR can refresh it; it also refreshes daily."}
    return {"available": True, **{k: b[k] for k in ("day", "created_utc", "sources", "method", "topics",
                                                    "emerging_roles", "declining_roles", "evidence")}}


def _board(day: str | None = None):
    return signals.latest_board(signals.db(cfg.database_path), day)


@app.get("/api/signals/today")
def signals_today(day: str | None = None):  # public, read-only: shown on the landing page without login
    return _board_summary(_board(day[:10] if day else None))


@app.get("/api/signals/history")
def signals_history():  # public, like today's board: aggregate topic strength, nothing personal
    con = signals.db(cfg.database_path)
    out = []
    for d in reversed(signals.history_days(con, 30)):
        b = signals.latest_board(con, d)
        out.append({"day": d, "z": {t["id"]: t["z"] for t in b["topics"]},
                    "direction": {t["id"]: t.get("direction", "stable") for t in b["topics"]}})
    return {"days": out, "topics": [{"id": t["id"], "label": t["label"], "kind": t["kind"]} for t in signals.TOPICS]}


REFRESHING = threading.Lock()


def _refresh_signals() -> bool:
    if not REFRESHING.acquire(blocking=False):
        return False

    def run():
        try:
            signals.refresh(con=signals.db(cfg.database_path))
        except Exception:
            log.exception("signal refresh failed")
        finally:
            REFRESHING.release()
    threading.Thread(target=run, daemon=True).start()
    return True


@app.post("/api/signals/refresh")
def signals_refresh(user: dict = Depends(need("hr_advisor"))):
    return {"started": _refresh_signals(), "running": REFRESHING.locked()}


def _daily():  # ponytail: in-process hourly check; use cron / a job queue when running more than one worker
    try:  # a restart the same day skips the refresh below, so re-index today's saved live passages
        from mcp_server.retrieval import restore_live
        log.info("live index ready: %s passages", restore_live())
    except Exception:
        log.exception("live index restore failed; the next daily refresh rebuilds it")
    while True:
        b = _board()
        if not b or b["day"] < datetime.now(timezone.utc).date().isoformat():
            _refresh_signals()
        time.sleep(3600)


# --- matching: quiz game + resume deep analysis --------------------------------------------------------------
def _matches(levels: dict, prefixes: list[str] | None = None, text: str | None = None, k: int = 8,
             zone: int | None = None, scenario: str = "assistive") -> list[dict]:
    board = _board()
    try:
        rows = matcher.match_roles(levels, k, board, text, prefixes or None, zone, scenario)
    except ImportError:
        log.exception("Career matching runtime is missing")
        raise HTTPException(503, "Career matching is temporarily unavailable: the server's local AI runtime needs setup. Your quiz answers are kept on this page; try again after setup.") from None
    em_cut, pr_cut = _cuts(board["day"]) if board else (None, None)
    for r in rows:
        r["emerging"] = em_cut is not None and r["emergence"] >= em_cut   # top 10% of today's board
        r["under_pressure"] = pr_cut is not None and r["pressure"] >= pr_cut
        items, _ = role_sdgs(r["soc"])
        r["sdgs"] = [{"goal": x["goal"], "short": goal_meta(x["goal"])["short"], "color": goal_meta(x["goal"])["color"],
                      "target": x.get("target"), "target_text": x.get("target_text", "")}
                     for x in items]
        r["drivers"] = (board or {}).get("occupations", {}).get(r["soc"], {}).get("topics", [])
    return rows


@lru_cache(maxsize=4)
def _cuts(day: str) -> tuple[float, float]:
    occ = _board(day)["occupations"].values()
    q = lambda key: float(sorted(v[key] for v in occ)[int(0.9 * len(occ))])
    return max(q("emergence"), 0.01), max(q("pressure"), 0.01)


@app.get("/api/quiz")
def quiz_questions(user: dict = Depends(current_user)):
    return quiz.questions()


class QuizIn(BaseModel):
    answers: dict[str, int] = Field(max_length=40)
    fields: list[str] = Field(default=[], max_length=13)
    zone: int | None = Field(default=None, ge=1, le=5)  # ISCO-08 skill level (1-4) from the training question
    scenario: str = Field(default="assistive", pattern="^(assistive|agentic)$")


@app.post("/api/quiz/score")
def quiz_score(body: QuizIn, user: dict = Depends(current_user)):
    levels, prefixes = quiz.score(body.answers, body.fields)
    if len(levels) < 3:
        raise HTTPException(422, "Answer at least three questions.")
    skills = [{"name": k, "level": v} for k, v in levels.items()]
    matches = _matches(levels, prefixes, quiz.profile_text(body.answers, body.fields) or None, zone=body.zone, scenario=body.scenario)
    assessment_id = None
    if user["role"] == "employee":
        with DB_LOCK, db:
            assessment_id = interview_store.save_recommendations(db, user["employee_id"], "questionnaire", skills, matches)
    return {"skills": skills, "matches": matches, "assessment_id": assessment_id}


class MatchIn(BaseModel):
    skills: list[SkillIn] = Field(max_length=60)
    text: str | None = Field(default=None, max_length=20000)
    fields: list[str] = Field(default=[], max_length=13)
    scenario: str = Field(default="assistive", pattern="^(assistive|agentic)$")
    assessment_id: str | None = Field(default=None, max_length=40)


@app.post("/api/match")
def match(body: MatchIn, user: dict = Depends(current_user)):
    if body.assessment_id:
        with DB_LOCK:
            if user["role"] != "employee" or not interview_store.valid_assessment(
                    db, body.assessment_id, user["employee_id"], source="resume"):
                raise HTTPException(404, "Resume assessment not found.")
    _, prefixes = quiz.score({}, body.fields)
    matches = _matches({s.name: s.level for s in body.skills}, prefixes, body.text, scenario=body.scenario)
    assessment_id = None
    if body.assessment_id and matches:
        with DB_LOCK, db:
            assessment_id = interview_store.save_recommendations(db, user["employee_id"], "resume",
                [s.model_dump() for s in body.skills], matches, parent_assessment_id=body.assessment_id)
    return {"matches": matches, "assessment_id": assessment_id}


async def _read(file: UploadFile) -> bytes:
    data = await file.read(resume.MAX_BYTES + 1)
    if len(data) > resume.MAX_BYTES:
        raise HTTPException(413, "File too large (2 MB max).")
    return data


def _resume_allowed(user: dict):
    if user["role"] == "employee" and _plan(user) not in billing.FULL:
        raise HTTPException(402, "Résumé analysis is part of Pro. See plans to upgrade.")


@app.post("/api/resume/analyze/stream")
async def resume_analyze_stream(file: UploadFile = File(...), user: dict = Depends(current_user)):
    _resume_allowed(user)
    """Same analysis as /api/resume/analyze, streamed: a progress event as each real stage starts, then the result."""
    data = await _read(file)
    name = file.filename or "resume.txt"
    events: queue.Queue = queue.Queue()

    def work():
        stage = lambda s: events.put({"t": "stage", "stage": s, "pct": RESUME_STAGES[s][0], "owl": RESUME_STAGES[s][1], "label": RESUME_STAGES[s][2]})
        try:
            result = _analyze_resume(name, data, stage)
            if user["role"] == "employee" and result["skills"]:
                profile = [{"name": s["name"], "level": s["level"]} for s in result["skills"]]
                with DB_LOCK, db:
                    result["assessment_id"] = interview_store.save_recommendations(
                        db, user["employee_id"], "resume", profile, result["matches"])
            events.put({"t": "result", "pct": 100, "data": result})
        except HTTPException as e:
            events.put({"t": "error", "message": e.detail})
        except Exception:
            log.exception("resume analysis failed")
            events.put({"t": "error", "message": "The analysis failed. Please try again."})
        events.put(None)

    def gen():
        threading.Thread(target=_in_context(work), daemon=True).start()
        while (ev := events.get()) is not None:
            yield sse(ev)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/resume/analyze")
async def resume_analyze(file: UploadFile = File(...), user: dict = Depends(current_user)):
    _resume_allowed(user)
    """Resume -> Markdown -> evidence-backed skills -> matches; only skill labels and recommendations persist for interview access."""
    data = await _read(file)
    result = await run_in_threadpool(_analyze_resume, file.filename or "resume.txt", data)
    if user["role"] == "employee" and result["skills"]:
        profile = [{"name": s["name"], "level": s["level"]} for s in result["skills"]]
        with DB_LOCK, db:
            result["assessment_id"] = interview_store.save_recommendations(
                db, user["employee_id"], "resume", profile, result["matches"])
    return result


RESUME_STAGES = {  # stage -> (% done when it starts, owl state, label); fixed per step, not a time estimate
    "read": (10, "searching", "Reading your file"), "guard": (22, "analyzing", "Checking for hidden text and injected instructions"),
    "skills": (40, "analyzing", "Finding skills (MiniLM semantic match)"), "llm": (58, "thinking", "AI agent reading your résumé"),
    "verify": (72, "analyzing", "Verifying every quote and checking fraud signals"), "match": (82, "searching", "Matching you to ESCO jobs"),
    "advice": (92, "thinking", "Writing your profile and advice"),
}


def _analyze_resume(filename: str, data: bytes, progress=lambda stage: None) -> dict:
    progress("read")
    try:
        md, integrity = resume.convert(filename, data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    progress("guard")
    progress("skills")
    x = resume.extract(md, progress=progress if cfg.llm_resume else None)
    progress("verify")
    x["skills"] = resume.verify(md, x["skills"])
    integrity["findings"] += fraud_signals(md, x["years_experience"], n_skills=len(x["skills"]))
    integrity["risk"] = doc_risk(integrity["findings"])
    levels = {s["name"]: s["level"] for s in x["skills"]}
    progress("match")
    matches = _matches(levels, text=resume.redact(md)) if levels else []
    progress("advice")
    return {"markdown": md, "skills": x["skills"], "years_experience": x["years_experience"], "education": x.get("education", []), "experience": x.get("experience", []), "integrity": integrity,
            "extraction_mode": x["extraction_mode"], "llm_usage": x["llm_usage"], "matches": matches,
            "insight": resume.advise(md, x["skills"], matches, x["years_experience"])}


# --- HR recruiting: openings with NL thresholds, AI screening agents, human decisions ------------------------
class CriteriaIn(BaseModel):
    text: str = Field(max_length=1000)
    soc: str | None = Field(default=None, max_length=12)


@app.post("/api/criteria/parse")
def criteria_parse(body: CriteriaIn, user: dict = Depends(need("hr_advisor"))):
    c = criteria.parse(body.text, body.soc)
    return {"criteria": c, "summary": criteria.describe(c)}


class OpeningIn(BaseModel):
    soc: str = Field(max_length=12)
    title: str = Field(default="", max_length=80)
    criteria_text: str = Field(default="", max_length=1000)


def _opening_or_404(oid: str) -> dict:
    with DB_LOCK:
        o = recruiting.get_opening(db, oid)
    if not o:
        raise HTTPException(404, "opening not found")
    return o


@app.post("/api/openings")
def opening_create(body: OpeningIn, request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    o = occupation(body.soc)
    if not o:
        raise HTTPException(422, "Unknown occupation: pick one from the ESCO search.")
    c = criteria.parse(body.criteria_text, body.soc)
    try:
        with DB_LOCK:
            new = recruiting.create_opening(db, user["username"], body.soc, body.title or o["title"], body.criteria_text, c)
    except ValueError as e:
        raise HTTPException(422, str(e))
    # accounts set to "post new openings automatically" get it now, in the background (the agent + network calls)
    threading.Thread(target=_in_context(plugins.publish), daemon=True, args=(db, DB_LOCK, cfg, user["username"], new, criteria.describe(c),
                     _apply_link(request, new), "posting-agent"), kwargs={"auto_only": True}).start()
    return new


@app.get("/api/openings")
def opening_list(user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        rows = recruiting.list_openings(db)
    return [{k: o[k] for k in ("id", "soc", "title", "status", "token", "created_utc", "criteria_text")}
            | {"applications": o["applications"][0], "recommended": o["applications"][1] or 0} for o in rows]


def _ranked(o: dict) -> list[dict]:
    """Ranking agent over every application; persists who is recommended (logged when it changes)."""
    with DB_LOCK:
        apps = recruiting.list_applications(db, o["id"])
    ids, why = screening.rank_candidates(apps, o["criteria"])
    with DB_LOCK:
        recruiting.set_recommendations(db, o["id"], ids)
    for a in apps:
        a["recommended"], a["reason"] = a["id"] in ids, why[a["id"]]
        a["rank"] = ids.index(a["id"]) + 1 if a["id"] in ids else None
    return sorted(apps, key=lambda a: (a["rank"] is None, a["rank"] or 0, -a["fit"]))


@app.get("/api/openings/{oid}")
def opening_detail(oid: str, user: dict = Depends(need("hr_advisor"))):
    o = _opening_or_404(oid)
    apps = _ranked(o)
    with DB_LOCK:
        trail = recruiting.events(db, oid)
    return {**o, "summary": criteria.describe(o["criteria"]), "candidates": apps, "events": trail[-50:],
            "apply_path": f"apply.html#{o['token']}"}  # relative: works on any static frontend host


@app.post("/api/openings/{oid}/criteria")
def opening_criteria(oid: str, body: CriteriaIn, user: dict = Depends(need("hr_advisor"))):
    o = _opening_or_404(oid)
    c = criteria.parse(body.text, o["soc"])
    try:
        with DB_LOCK:
            recruiting.update_criteria(db, oid, user["username"], body.text, c)
            rows = recruiting.resumes(db, oid)
    except ValueError as e:
        raise HTTPException(422, str(e))
    board = _board()
    for aid, md, old in rows:  # the screening agents re-judge every application against the new thresholds
        r = screening.screen("resume.md", md.encode("utf-8"), o["soc"], c, board)
        prev = json.loads(old or "{}")
        if prev.get("integrity"):  # findings about the ORIGINAL file (hidden text etc.) must survive re-screening
            r["analysis"]["integrity"], r["analysis"]["held"] = prev["integrity"], prev.get("held", False)
        with DB_LOCK:
            recruiting.update_analysis(db, aid, r["analysis"])
    return {"criteria": c, "summary": criteria.describe(c), "rescreened": len(rows)}


class StatusIn(BaseModel):
    status: str = Field(pattern="^(open|closed)$")


@app.post("/api/openings/{oid}/status")
def opening_status(oid: str, body: StatusIn, user: dict = Depends(need("hr_advisor"))):
    _opening_or_404(oid)
    with DB_LOCK:
        recruiting.set_status(db, oid, user["username"], body.status)
    return {"status": body.status}


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(shortlisted|declined|on_hold)$")
    note: str = Field(default="", max_length=500)


@app.post("/api/applications/{aid}/decision")
def application_decision(aid: str, body: DecisionIn, user: dict = Depends(need("hr_advisor"))):
    try:
        with DB_LOCK:
            return recruiting.decide(db, aid, user["username"], body.decision, body.note)
    except ValueError as e:
        raise HTTPException(404 if "not found" in str(e) else 422, str(e))


# --- HR: organisation users (invited by email; no self sign-up) ---------------------------------------------
def _member(hr: str, username: str) -> dict:
    with DB_LOCK:
        a = accounts.account(db, username)
    if not a or a.get("invited_by") != hr:
        raise HTTPException(404, "no such member of your organisation")
    return a


@app.get("/api/org/users")
def org_users(user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        rows = db.execute(f"SELECT {','.join(accounts.KEYS)} FROM users WHERE invited_by=? ORDER BY created_utc DESC",
                          (user["username"],)).fetchall()
    keep = ("username", "display_name", "email", "status", "created_utc")
    return [{k: v for k, v in zip(accounts.KEYS, r) if k in keep} for r in rows]


class OrgInviteIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    display_name: str = Field(default="", max_length=60)


@app.post("/api/org/invite")
def org_invite(body: OrgInviteIn, request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    try:
        with DB_LOCK:
            a = accounts.invite(db, user["username"], body.email, body.display_name)
            sent = otp.issue(db, cfg, a["username"], a["email"], _base_url(request), "invite", inviter=user["display_name"])
    except accounts.AuthError as e:
        raise HTTPException(422, str(e))
    return {"username": a["username"], "email": a["email"], "status": a["status"], "emailed": sent}


@app.post("/api/org/users/{username}/resend")
def org_resend(username: str, request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    a = _member(user["username"], username)
    if a["status"] != "invited":
        raise HTTPException(409, "This person already accepted the invite.")
    with DB_LOCK:
        sent = otp.issue(db, cfg, a["username"], a["email"], _base_url(request), "invite", inviter=user["display_name"])
    return {"emailed": sent}


class OrgStatusIn(BaseModel):
    status: str = Field(pattern="^(active|disabled)$")


@app.post("/api/org/users/{username}/status")
def org_status(username: str, body: OrgStatusIn, user: dict = Depends(need("hr_advisor"))):
    a = _member(user["username"], username)
    if a["status"] == "invited":
        raise HTTPException(409, "Not accepted yet: resend or withdraw the invite instead.")
    with DB_LOCK:
        accounts.set_status(db, a["username"], body.status)
        accounts._event(db, a["username"], f"status set by HR {user['username']}")
        if body.status == "disabled":
            db.execute("DELETE FROM sessions WHERE username=?", (a["username"],))
            db.commit()
    return {"status": body.status}


@app.delete("/api/org/users/{username}")
def org_remove(username: str, user: dict = Depends(need("hr_advisor"))):
    """Withdraw an invite, or remove the account and its personal data (as self-service deletion does)."""
    a = _member(user["username"], username)
    with DB_LOCK:
        deletion.delete_account(db, a["username"])
    return {"ok": True}


# --- HR: hiring plugins (post openings to LinkedIn, Facebook, X, Telegram, Discord, Slack) -----------------
def _apply_link(request: HttpRequest, o: dict) -> str:
    return f"{_base_url(request).rstrip('/')}/apply.html#{o['token']}"  # a static page: works on every frontend site


def _oauth_return(request: HttpRequest, platform: str) -> str:
    """Always this backend (the address registered in each platform's app), whichever frontend started."""
    return f"{(cfg.public_url or _backend_url(request)).rstrip('/')}/api/plugins/oauth/{platform}/callback"


@app.get("/api/plugins")
def plugins_list(request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        conns = plugins.connections(db, user["username"])
    ready = plugins.available(cfg)
    return {"connections": conns, "platforms": [{"id": p, "name": n, "available": ready[p], "oauth": p in plugins.OAUTH,
            "redirect_uri": _oauth_return(request, p) if p in plugins.OAUTH else None} for p, n in plugins.PLATFORMS.items()]}


class PluginConnectIn(BaseModel):
    platform: str = Field(pattern="^(telegram|discord|slack)$")
    bot_token: str = Field(default="", max_length=80)
    chat_id: str = Field(default="", max_length=40)
    webhook_url: str = Field(default="", max_length=300)
    label: str = Field(default="", max_length=80)


@app.post("/api/plugins/connect")
def plugins_connect(body: PluginConnectIn, user: dict = Depends(need("hr_advisor"))):
    try:  # checks the token with the platform first (network): not under DB_LOCK
        label, secret = plugins.check_simple(body.platform, body.model_dump())
    except plugins.PluginError as e:
        raise HTTPException(422, str(e))
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach the platform to check that. Try again.")
    with DB_LOCK:
        plugins.init(db)
        return {"id": plugins.save(db, cfg, user["username"], body.platform, label, secret)}


class OAuthStartIn(BaseModel):
    org_id: str = Field(default="", max_length=20)  # LinkedIn company page id


@app.post("/api/plugins/oauth/{platform}/start")
def plugins_oauth_start(platform: str, body: OAuthStartIn, request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    try:
        with DB_LOCK:
            return {"url": plugins.authorize_url(db, cfg, user["username"], platform, _oauth_return(request, platform),
                                                 {"org_id": body.org_id.strip(), "back": _foreign_origin(request) or ""})}
    except plugins.PluginError as e:
        raise HTTPException(422, str(e))


@app.get("/api/plugins/oauth/{platform}/callback")
def plugins_oauth_callback(platform: str, request: HttpRequest, code: str = "", state: str = "", error: str = ""):
    """The platform sends the HR advisor back here. Who they are comes from `state` (made when they clicked Connect),
    not from the session cookie, which a cross-site redirect does not carry (SameSite=Strict)."""
    with DB_LOCK:
        row = db.execute("SELECT extra FROM plugin_oauth_states WHERE state=?", (state[:80],)).fetchone() if state else None
    front = json.loads(row[0] or "{}").get("back", "") if row else ""
    back = f"{front if front in _frontends() else ''}/enterprise.html#/plugins"  # back to the site the advisor started on
    if error or not code or not state or platform not in plugins.OAUTH:
        return RedirectResponse(f"{back}/cancelled", status_code=303)
    try:
        plugins.finish_oauth(db, DB_LOCK, cfg, platform, code[:2000], state[:80], _oauth_return(request, platform))
    except Exception as e:
        log.warning("plugin sign-in failed (%s): %s", platform, type(e).__name__)
        return RedirectResponse(f"{back}/failed", status_code=303)
    return RedirectResponse(f"{back}/connected", status_code=303)


class AutoIn(BaseModel):
    auto: bool


@app.post("/api/plugins/{cid}/auto")
def plugins_auto(cid: str, body: AutoIn, user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        if not plugins.set_auto(db, user["username"], cid[:20], body.auto):
            raise HTTPException(404, "no such connection")
    return {"auto": body.auto}


@app.delete("/api/plugins/{cid}")
def plugins_remove(cid: str, user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        if not plugins.remove(db, user["username"], cid[:20]):
            raise HTTPException(404, "no such connection")
    return {"ok": True}


class PublishIn(BaseModel):
    connections: list[str] = Field(default_factory=list, max_length=50)  # empty = every connected account


@app.post("/api/openings/{oid}/publish")
def opening_publish(oid: str, body: PublishIn, request: HttpRequest, user: dict = Depends(need("hr_advisor"))):
    """The posting agent writes a post per platform and sends the opening to the HR advisor's connected accounts."""
    o = _opening_or_404(oid)
    if o["status"] != "open":
        raise HTTPException(409, "This opening is closed. Reopen it to post it.")
    results = plugins.publish(db, DB_LOCK, cfg, user["username"], o, criteria.describe(o["criteria"]), _apply_link(request, o),
                              user["username"], only=body.connections or None)
    if not results:
        raise HTTPException(409, "No accounts connected yet. Add one under Hiring plugins.")
    return {"results": results}


@app.get("/api/openings/{oid}/posts")
def opening_posts(oid: str, user: dict = Depends(need("hr_advisor"))):
    _opening_or_404(oid)
    with DB_LOCK:
        return plugins.history(db, oid)


# --- AI models per task (admin allows, HR chooses for their organisation) ----------------------------------
SPEC = r"^(openai|gemini):[\w.\-/:]{1,80}$"


class ModelIn(BaseModel):
    spec: str = Field(pattern=SPEC)
    label: str = Field(default="", max_length=60)


@app.get("/api/admin/models")
def admin_models(user: dict = Depends(need("admin"))):
    with DB_LOCK:
        rows = db.execute("SELECT spec, label FROM model_catalog ORDER BY label").fetchall()
    return {"catalog": [{"spec": s, "label": lb, "ready": llm.usable(s)} for s, lb in rows], "providers": llm.providers(),
            "defaults": {t: llm.model_for(t, org=False) or None for t in llm.TASKS}, "tasks": llm.TASKS, "speech": llm.stt_model() or None}


@app.post("/api/admin/models")
def admin_model_add(body: ModelIn, user: dict = Depends(need("admin"))):
    with DB_LOCK, db:
        db.execute("INSERT OR REPLACE INTO model_catalog VALUES(?,?,?)",
                   (body.spec, body.label.strip() or body.spec.split(":", 1)[1], datetime.now(timezone.utc).isoformat(timespec="seconds")))
    return {"spec": body.spec}


@app.delete("/api/admin/models")
def admin_model_remove(spec: str, user: dict = Depends(need("admin"))):
    with DB_LOCK, db:  # organisations that chose it go back to the default
        db.execute("DELETE FROM org_models WHERE spec=?", (spec,))
        n = db.execute("DELETE FROM model_catalog WHERE spec=?", (spec,)).rowcount
    if not n:
        raise HTTPException(404, "not in the list")
    return {"ok": True}


@app.get("/api/org/models")
def org_models_get(user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK:
        cat = db.execute("SELECT spec, label FROM model_catalog ORDER BY label").fetchall()
        mine = dict(db.execute("SELECT task, spec FROM org_models WHERE owner=?", (user["username"],)).fetchall())
    return {"tasks": [{"id": t, "label": d, "chosen": mine.get(t), "default": llm.model_for(t, org=False) or None} for t, d in llm.TASKS.items()],
            "catalog": [{"spec": s, "label": lb} for s, lb in cat if llm.usable(s)]}


class OrgModelIn(BaseModel):
    task: str = Field(pattern="^(coach|resume|recruiter)$")
    spec: str = Field(default="", max_length=90)  # "" = the default


@app.post("/api/org/models")
def org_models_set(body: OrgModelIn, user: dict = Depends(need("hr_advisor"))):
    with DB_LOCK, db:
        if not body.spec:
            db.execute("DELETE FROM org_models WHERE owner=? AND task=?", (user["username"], body.task))
            return {"task": body.task, "spec": None}
        if not db.execute("SELECT 1 FROM model_catalog WHERE spec=?", (body.spec,)).fetchone() or not llm.usable(body.spec):
            raise HTTPException(422, "Pick a model from the list.")
        db.execute("INSERT OR REPLACE INTO org_models VALUES(?,?,?)", (user["username"], body.task, body.spec))
    return {"task": body.task, "spec": body.spec}


# --- voice and plain-language features (paid plans) -------------------------------------------------------
VOICE_PLANS = {"pro", "team", "org"}
AUDIO_TYPES = ("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac")


# Text-to-speech in one server voice, so read-aloud and the interviewer sound the same in every browser. Each text is
# spoken once and kept (the interview asks for its question before the room needs it). ~48 KB of WAV per second.
_SPEECH = ThreadPoolExecutor(max_workers=3)
_spoken: dict = {}
_spoken_lock = threading.Lock()
SPEECH_KEEP = 200  # recent texts kept in memory


def _speech(text: str):
    text = " ".join(text.split())[:4000]
    key = hashlib.sha256(f"{cfg.tts_model}|{cfg.tts_voice}|{cfg.tts_style}|{text}".encode()).hexdigest()
    with _spoken_lock:
        job = _spoken.pop(key, None)
        if job is None or (job.done() and job.result()[0] is None):  # a failed attempt is retried
            job = _SPEECH.submit(llm.speak, text)
        _spoken[key] = job  # most recently used last
        while len(_spoken) > SPEECH_KEEP:
            _spoken.pop(next(iter(_spoken)))
    return job


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=6000)


@app.post("/api/speech/say")
def speech_say(body: SpeakIn, user: dict = Depends(current_user)):
    """The text read aloud in the server voice (WAV). 503 when no speech model is set up: the page then uses the
    browser's own voice."""
    if not llm.tts_model():
        raise HTTPException(503, "Read-aloud voice is not set up.")
    audio, _ = _speech(body.text).result(timeout=90)  # llm.speak records the model call, once per text
    if audio is None:
        raise HTTPException(503, "The read-aloud voice is unavailable right now.")
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/speech/transcribe")
async def speech_transcribe(file: UploadFile = File(...), lang: str = Form(""), user: dict = Depends(current_user)):
    """Voice input for every browser (server speech-to-text). Paid plans; the audio is not stored."""
    if _plan(user) not in VOICE_PLANS:
        raise HTTPException(402, "Voice input is part of Pro and Team. See plans to upgrade.")
    mime = (file.content_type or "").split(";")[0]
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, "Unsupported audio format.")
    audio = await file.read(10 * 1024 * 1024 + 1)
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(413, "Recording too long: keep it under 2 minutes.")
    if len(audio) < 800:
        raise HTTPException(422, "Nothing was recorded. Check your microphone and try again.")
    text, usage = await run_in_threadpool(llm.transcribe, audio, mime, lang[:10])
    if usage:
        _record_usage(user["username"], "voice", usage)
    if text is None:
        raise HTTPException(503, "Voice input is unavailable right now. Please type instead.")
    return {"text": text[:4000]}


SKILL_STEP = re.compile(r"([^:()]+?)\s*\(level (\d+)\s*(?:->|→)\s*(\d+)\)")  # "...: sql (level 2 -> 4)" or "(level 0 → 5)"


def _org_snapshot(hr: str) -> dict:
    """What "ask your data" may use: this advisor's team plans, openings and team members. Pseudonymous ids only."""
    with DB_LOCK:
        plans = approval.list_plans(db, {"role": "hr_advisor", "username": hr})
        snaps = {r[0]: json.loads(r[1] or "{}") for r in db.execute(
            "SELECT p.plan_id, v.snapshot FROM plans p JOIN plan_versions v ON v.plan_id=p.plan_id WHERE p.audience='hr' "
            "AND v.version=(SELECT max(version) FROM plan_versions WHERE plan_id=p.plan_id)")}
        openings = recruiting.list_openings(db)
        people = db.execute("SELECT status, count(*) FROM users WHERE invited_by=? GROUP BY status", (hr,)).fetchall()
    latest = {}
    for p in plans:  # newest plan per employee
        latest.setdefault(p["subject_id"], p)
    team = []
    for sid, p in list(latest.items())[:200]:
        acts = snaps.get(p["plan_id"], {}).get("activities", [])
        steps = sorted({f"{m[1].strip()} {m[2]}→{m[3]}" for a in acts if (m := SKILL_STEP.search(a.get("activity", "")))})[:8]
        team.append({"employee": sid, "target_role": (occupation(p["target_role"]) or {}).get("title", p["target_role"]),
                     "plan_status": p["status"], "learning_hours": round(sum(a.get("estimated_hours", 0) for a in acts)),
                     "skill_steps": steps})
    return {"team": team, "openings": [{"title": o["title"], "status": o["status"], "applicants": o["applications"][0],
                                        "recommended": o["applications"][1] or 0} for o in openings[:50]],
            "members": {s: n for s, n in people}}


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@app.post("/api/hr/ask")
def hr_ask(body: AskIn, user: dict = Depends(paid_feature("hr_advisor", {"team", "org"}, "Ask your data"))):
    """Plain-language questions about the advisor's own team and hiring data. Answers only from that data."""
    data = _org_snapshot(user["username"])
    text, usage = llm.generate(f"<QUESTION>{body.question}</QUESTION>\n<DATA>\n{json.dumps(data)[:30000]}\n</DATA>",
                               "You answer an HR advisor's question using ONLY the DATA (their team's reskilling plans, job "
                               "openings and team members). Employees are pseudonymous ids: never guess real names. If the data "
                               "can't answer, say what is missing. Be brief: 1-4 sentences or a short list. Never rank people by "
                               "age, gender, ethnicity or other protected traits. Return JSON {\"answer\": str, \"employees\": "
                               "[ids you relied on]}.", max_tokens=600, json=True, agent="recruiter")
    if usage:
        _record_usage(user["username"], "ask", usage)
    try:
        out = json.loads(text) if text else None
    except ValueError:
        out = None
    if not out or not out.get("answer"):  # no model: the facts, plainly
        roles = sorted({t["target_role"] for t in data["team"]})
        out = {"answer": f"{len(data['team'])} people have plans ({', '.join(roles[:6]) or 'none yet'}); "
                         f"{sum(o['status'] == 'open' for o in data['openings'])} openings are open. "
                         "Detailed answers need an AI model, which isn't set up right now.", "employees": []}
    known = {t["employee"] for t in data["team"]}
    return {"answer": str(out["answer"])[:2000], "employees": [e for e in out.get("employees", []) if e in known][:20]}


class DraftIn(BaseModel):
    text: str = Field(min_length=10, max_length=3000)


@app.post("/api/openings/draft")
def opening_draft(body: DraftIn, user: dict = Depends(paid_feature("hr_advisor", {"team", "org"}, "Voice job drafts"))):
    """A role described in plain words (typed or spoken) -> a draft opening for the advisor to check: title,
    occupation and screening thresholds. Nothing is created until they press Create."""
    text, usage = llm.generate(body.text, "Turn an HR advisor's description of a job into JSON {\"title\": short job title, "
                               "\"occupation\": 1-3 words naming the occupation for a search, \"criteria\": one line of screening "
                               "thresholds in plain English, e.g. 'Top 5. Must know Excel and SQL, 3+ years, match above 60%'}. "
                               "Leave out anything about age, gender, ethnicity, religion, marital status or other protected traits.",
                               max_tokens=300, json=True, agent="recruiter")
    if usage:
        _record_usage(user["username"], "draft", usage)
    try:
        d = json.loads(text) if text else {}
    except ValueError:
        d = {}
    title = str(d.get("title") or "").strip()[:80]
    query = str(d.get("occupation") or title or body.text).strip()
    hits = search_occupations(query, limit=5) or search_occupations(" ".join(query.split()[-1:]), limit=5)
    crit = str(d.get("criteria") or "").strip()[:1000]
    parsed = criteria.parse(crit, hits[0]["soc"] if hits else None) if crit else {}
    return {"title": title, "occupations": hits, "criteria_text": crit, "summary": criteria.describe(parsed) if crit else [],
            "ai": bool(text)}


# --- agents people can find and talk to (the Agents page; like a GPT/Project gallery) -----------------------
AGENT_DAILY = {"free": 20}  # agent messages per day on the free plan; paid and organisation plans: AGENT_DAILY_MAX
AGENT_DAILY_MAX = 300       # ponytail: a plain abuse cap per account and day; per-plan limits if costs need it


@app.get("/api/agents")
def agents_list(user: dict = Depends(current_user)):
    return {"agents": catalog.for_role(user["role"])}


class ChatMsg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AgentChatIn(BaseModel):
    messages: list[ChatMsg] = Field(min_length=1, max_length=24)
    profile: dict | None = None  # the skills and target job this browser keeps (public app), for the coaches


def _my_plans(user: dict) -> list[dict]:
    """The person's own plans, as the coaches see them: job, status, the skill steps and hours. No ids or names."""
    with DB_LOCK:
        rows = approval.list_plans(db, user)[:6]
        snaps = {pid: json.loads(s or "{}") for pid, s in db.execute(
            "SELECT p.plan_id, v.snapshot FROM plans p JOIN plan_versions v ON v.plan_id=p.plan_id WHERE p.plan_id IN ({}) "
            "AND v.version=(SELECT max(version) FROM plan_versions WHERE plan_id=p.plan_id)".format(",".join("?" * len(rows))),
            [r["plan_id"] for r in rows])} if rows else {}
    out = []
    for r in rows:
        acts = snaps.get(r["plan_id"], {}).get("activities", [])
        out.append({"target_job": (occupation(r["target_role"]) or {}).get("title", r["target_role"]), "status": r["status"],
                    "made": r["created_utc"][:10], "learning_hours": round(sum(a.get("estimated_hours", 0) for a in acts)),
                    "steps": [f"days {a.get('day_range')}: {a.get('activity')}" for a in acts[:8]]})
    return out


def _agent_context(agent: dict, user: dict, profile: dict | None) -> dict:
    if agent["id"] == "trends":
        b = _board()
        if not b:
            return {"board": "No trend board yet."}
        return {"day": b["day"], "topics": [{"topic": t["label"], "direction": t.get("direction"), "strength": t["z"],
                                             "kind": t["kind"], "skills": t.get("skills", [])} for t in b["topics"]],
                "roles_pulled_forward": [{"role": r["title"], "score": r["score"]} for r in b["emerging_roles"][:10]],
                "roles_under_pressure": [{"role": r["title"], "pressure": r["pressure"]} for r in b["declining_roles"][:10]]}
    if agent["id"] == "team":
        return _org_snapshot(user["username"])
    if agent["id"] in ("hiring", "posts"):
        with DB_LOCK:
            rows = recruiting.list_openings(db)[:15]
        return {"openings": [{"title": o["title"], "status": o["status"], "applicants": o["applications"][0],
                              "recommended": o["applications"][1] or 0, "requirements": criteria.describe(o["criteria"])}
                             for o in rows]}
    p = profile or {}
    skills = [{"skill": str(s.get("name", ""))[:60], "level": s.get("level")} for s in (p.get("skills") or [])[:30] if isinstance(s, dict)]
    return {"target_job": str(p.get("target_title") or "")[:80] or None, "my_skills": skills, "my_plans": _my_plans(user)}


@app.post("/api/agents/{agent_id}/chat")
def agent_chat(agent_id: str, body: AgentChatIn, user: dict = Depends(current_user)):
    # "auto": the one agent people talk to; it hands each message to the right specialist
    agent = (catalog.route(user["role"], [m.content for m in body.messages if m.role == "user"]) if agent_id == "auto"
             else catalog.BY_ID.get(agent_id))
    if not agent or agent["kind"] != "chat" or agent not in [catalog.BY_ID[a["id"]] for a in catalog.for_role(user["role"])]:
        raise HTTPException(404, "No such agent for your account.")
    if body.messages[-1].role != "user":
        raise HTTPException(422, "The last message must be yours.")
    limit = AGENT_DAILY.get(_plan(user), AGENT_DAILY_MAX)
    today = datetime.now(timezone.utc).date().isoformat()
    with DB_LOCK, db:
        used = db.execute("SELECT COUNT(*) FROM agent_log WHERE username=? AND substr(at_utc,1,10)=?", (user["username"], today)).fetchone()[0]
        if used >= limit:
            raise HTTPException(402 if limit < AGENT_DAILY_MAX else 429,
                                f"You've used today's {limit} agent messages. " + ("Pro has more. See plans to upgrade." if limit < AGENT_DAILY_MAX else "Try again tomorrow."))
        db.execute("INSERT INTO agent_log VALUES(?,?,?)", (user["username"], agent_id, datetime.now(timezone.utc).isoformat()))
    context = _agent_context(agent, user, body.profile)
    talk = "\n".join(f"{'Person' if m.role == 'user' else 'You'}: {m.content}" for m in body.messages[-12:])
    text, usage = llm.generate(f"<CONTEXT>\n{json.dumps(context, ensure_ascii=False)[:24000]}\n</CONTEXT>\n<CONVERSATION>\n{talk}\n</CONVERSATION>\n"
                               "Reply to the person's last message.", catalog.system_prompt(agent), max_tokens=700, agent=agent["task"])
    if usage:
        _record_usage(user["username"], f"agent:{agent_id}", usage)
    if not text:
        raise HTTPException(503, "The agent can't answer right now. Please try again in a moment.")
    return {"reply": text.strip()[:6000], "model": (usage or {}).get("model"), "agent": {"id": agent["id"], "name": agent["name"]}}


# --- public application link (no account; consent required) --------------------------------------------------
def _open_by_token(token: str) -> dict:
    with DB_LOCK:
        o = recruiting.get_opening(db, token=token[:40])
    if not o or o["status"] != "open":
        raise HTTPException(404, "This application link is closed or does not exist.")
    return o


@app.get("/api/apply/{token}")
def apply_info(token: str):
    o = _open_by_token(token)
    occ = occupation(o["soc"]) or {}
    return {"title": o["title"], "occupation": occ.get("title"), "description": occ.get("description", "")[:400],
            "privacy": "Your resume is converted to text and screened by AI agents with your name and contact details "
                       "hidden. A human HR advisor makes every decision and sees your contact details only if you are "
                       "shortlisted. The original file is not stored."}


APPLY_LIMIT, APPLY_WINDOW = 5, 600  # per client IP: 5 submissions / 10 minutes
APPLY_HITS: dict[str, list[float]] = {}


def _rate_limit(ip: str):  # ponytail: in-memory, per process; use a shared store behind a load balancer
    now_ = time.time()
    hits = [t for t in APPLY_HITS.get(ip, []) if now_ - t < APPLY_WINDOW]
    if len(hits) >= APPLY_LIMIT:
        raise HTTPException(429, "Too many submissions. Please try again later.")
    APPLY_HITS[ip] = hits + [now_]


@app.post("/api/apply/{token}")
async def apply_submit(token: str, request: HttpRequest, name: str = Form(..., max_length=80),
                       email: str = Form(..., max_length=120), consent: bool = Form(...), file: UploadFile = File(...),
                       website: str = Form(default="", max_length=200)):
    if website:  # honeypot field, invisible to people: bots fill it
        raise HTTPException(422, "Submission rejected.")
    _rate_limit(request.client.host if request.client else "?")
    o = _open_by_token(token)
    if not consent:
        raise HTTPException(422, "Consent is required to process your resume.")
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address.")
    data = await _read(file)

    def work():  # screening agents run off the event loop
        with DB_LOCK:
            seen = {fingerprint(md) for _, md, _ in recruiting.resumes(db, o["id"])}
        try:
            r = screening.screen(file.filename or "resume.txt", data, o["soc"], o["criteria"], _board(), seen)
            with DB_LOCK:
                aid = recruiting.add_application(db, o["id"], {"name": name.strip(), "email": email.strip()},
                                                 r["md"], r["redacted"], r["analysis"])
        except ValueError as e:
            raise HTTPException(422, str(e))
        _ranked(o)
        return aid
    aid = await run_in_threadpool(work)
    return {"ok": True, "reference": aid[:6].upper(), "message": "Thanks, your application was received."}


# --- static UI --------------------------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=WEB), name="static")


# Versioned assets: every page links /js/x.js?v=<content hash>, and an import map does the same for modules that import
# each other ("./lib.js"). After a deploy each changed file has a new URL, so no browser or Cloudflare copy of an old
# script can be mixed with new code ("the page still looks old"). Re-hashed only when a file's mtime changes.
def _asset_sig() -> tuple:
    return tuple((f.name, f.stat().st_mtime_ns) for d in ("js", "css", "vendor") for f in sorted((WEB / d).glob("*.*")))


@lru_cache(maxsize=2)
def _asset_build(sig: tuple) -> tuple[dict, str, str]:
    import base64
    versions = {"/" + f.relative_to(WEB).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()[:10]
                for d in ("js", "css", "vendor") for f in sorted((WEB / d).glob("*.*")) if f.suffix in (".js", ".css")}
    imap = json.dumps({"imports": {k: f"{k}?v={v}" for k, v in versions.items() if k.startswith("/js/")}}, separators=(",", ":"))
    csp = "sha256-" + base64.b64encode(hashlib.sha256(imap.encode()).digest()).decode()
    return versions, imap, csp


def _assets() -> tuple[dict, str, str]:
    return _asset_build(_asset_sig())


def _page(name: str) -> HTMLResponse:
    versions, imap, _ = _assets()
    html = (WEB / name).read_text(encoding="utf-8")
    html = re.sub(r'(src|href)="((?:js|css|vendor)/[\w.-]+\.(?:js|css))"',
                  lambda m: f'{m[1]}="/{m[2]}?v={versions.get("/" + m[2], "0")}"', html)
    return HTMLResponse(html.replace('<script type="module"', f'<script type="importmap">{imap}</script>\n  <script type="module"', 1),
                        headers={"Cache-Control": "no-cache"})


@app.get("/")
@app.get("/index.html")
def public_ui():
    return _page("index.html")


@app.get("/apply.html")
def apply_page():
    return _page("apply.html")


@app.get("/apply/{token}")
def apply_ui(token: str):  # old-style links -> the static page (token stays in the fragment, never in logs)
    return RedirectResponse(f"/apply.html#{token[:40]}", status_code=308)


@app.get("/enterprise")
@app.get("/enterprise.html")
def enterprise_ui():
    return _page("enterprise.html")


@app.get("/admin")
@app.get("/admin.html")
def admin_ui():
    return _page("admin.html")


@app.get("/healthz")
def health():
    return {"ok": True}


@app.get("/api/health")
def readiness():
    """Blueprint section 11: app, db, MCP, model and LLM readiness. No hostnames, paths or keys."""
    from agents.knowledge import mcp_status
    from forecasting.serving import paths
    try:
        db.execute("SELECT 1")
        dbs = {"ok": True}
    except Exception as e:
        dbs = {"ok": False, "error": type(e).__name__}
    ck, hist, man = paths()
    model = {"ok": all(p.exists() for p in (ck, hist, man)),
             "mode": "live_cpu_inference" if all(p.exists() for p in (ck, hist, man)) else "precomputed_asset"}
    from agents.llm import model_for
    llm = {"enabled": cfg.llm_enabled, "resume": cfg.llm_resume,
           "agents": {a: model_for(a) or None for a in ("router", "coach", "resume")}}  # model names only, never keys
    mcp = mcp_status()
    return {"ok": dbs["ok"] and mcp["ok"], "db": dbs, "mcp": mcp, "model": model, "llm": llm}


# web/ at the root too, so the HTML's relative asset paths (css/, js/, owl/, config.js) resolve exactly as they do on
# a separate static host. Mounted last: every /api route above wins.
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def _warm():
    """Fast path first (the model client, MCP knowledge tools, role list), then the slow MiniLM load."""
    llm.warm()  # ~5 s of client start-up that would otherwise land on the first interview question
    try:
        for soc in ("2221.2", "7411.1", "2411.1", "2512.3"):
            role_requirements(soc)
        from agents.matcher import _occ_index, occupation_vectors
        occupation_vectors(), _occ_index()
        from mcp_server.retrieval import ensure_index, warm
        warm()
        log.info("vector index ready: %s passages", ensure_index())  # one-time build on a fresh volume
    except Exception:
        log.exception("warm-up failed; vector search stays on the offline snapshot")


if cfg.warm_on_start:
    threading.Thread(target=_warm, daemon=True).start()
else:  # tests/CI: stay on the offline snapshot, start no model threads
    from mcp_server import retrieval as _retrieval
    _retrieval.AUTO_WARM = False
if cfg.signals_daily:
    threading.Thread(target=_daily, daemon=True).start()
