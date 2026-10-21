"""Web API + static UI for AiversePulse (public) and AiversePulse Enterprise (HR).

    uvicorn server.api:app --port 8600            # then open http://localhost:8600 (public) or /enterprise

Streaming: POST /api/analyze and /api/team return Server-Sent Events. Agent progress is real (one event per
agent as it finishes). The report text is streamed only AFTER the Reviewer has verified its citations, so the
chat-style typing never shows an unverified claim.
"""
import hashlib
import json
import logging
import queue
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

import pandas as pd
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request as HttpRequest, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from agents.gap_analyst import SCENARIO_NOTES
from agents.pathway import HOURS_PER_LEVEL
from agents.sdg import goal_meta, role_sdgs
from agents import criteria, matcher, quiz, resume
from agents.knowledge import occupation, resolve_occupation, role_requirements, search_occupations
from config.settings import get_settings
from core import graph, screening
from core.state import Pathway, Profile, Request, Skill
from core.team_import import parse_team
from core.usage import summarize
from governance import accounts, approval, recruiting
from mcp_server import signals
from mcp_server.ingest import occupation_url
from validation.document_guard import fingerprint, fraud_signals, risk as doc_risk
from governance.audit import connect
from validation.revision import validate

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
cfg = get_settings()
db = recruiting.init(accounts.init(connect(cfg.database_path)))
DB_LOCK = threading.Lock()  # one sqlite connection shared across request threads
SESSION_IDLE = timedelta(minutes=30)
COOKIE = "ap_session"
RESULTS: "OrderedDict[str, dict]" = OrderedDict()  # plan_id -> last run, to re-validate edits (bounded)

with DB_LOCK:
    db.executescript("""CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT, role TEXT,
                        employee_id TEXT, display_name TEXT, expires_utc TEXT);
                        CREATE TABLE IF NOT EXISTS plan_progress(plan_id TEXT, item TEXT, done_utc TEXT,
                        PRIMARY KEY(plan_id, item));""")  # activities ticked off as done ("<days>:<skill>")

app = FastAPI(title="AiversePulse", docs_url=None, redoc_url=None, openapi_url=None)
if cfg.allowed_origins:  # separate frontend deploy: only these origins may call the API with the session cookie
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=cfg.allowed_origins, allow_credentials=True,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-AP", "Accept"], max_age=600)


# --- security -------------------------------------------------------------------------------------
@app.middleware("http")
async def headers(request: HttpRequest, call_next):
    if request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith("/api/"):
        if request.headers.get("x-ap") != "1":  # custom header => cross-site forms can't post (CSRF)
            return JSONResponse({"detail": "missing X-AP header"}, status_code=403)
        origin = (request.headers.get("origin") or "").rstrip("/")
        own = f"{request.url.scheme}://{request.url.netloc}"
        if origin and origin != own and origin not in cfg.allowed_origins:  # defence in depth behind CORS
            return JSONResponse({"detail": "origin not allowed"}, status_code=403)
    resp = await call_next(request)
    resp.headers.update({
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' "
                                   "https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; "
                                   f"connect-src 'self'; frame-ancestors {cfg.frame_ancestors}; base-uri 'none'; form-action 'self'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()"})
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"  # revalidate (cheap 304 via ETag) so UI updates ship immediately
    return resp


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: HttpRequest) -> dict:
    token = request.cookies.get(COOKIE)
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


class Login(BaseModel):
    username: str = Field(max_length=40)
    password: str = Field(max_length=200)


@app.post("/api/login")
def login(body: Login, request: HttpRequest, response: Response):
    try:
        with DB_LOCK:
            user = accounts.authenticate(db, body.username, body.password, cfg.login_max_failures, cfg.login_lock_minutes)
    except accounts.AuthError as e:
        raise HTTPException(401, str(e))
    token = secrets.token_urlsafe(32)
    with DB_LOCK:
        db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?)", (_hash(token), user["username"], user["role"],
                   user["employee_id"], user["display_name"],
                   (datetime.now(timezone.utc) + SESSION_IDLE).isoformat()))
        db.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite=cfg.cookie_samesite,
                        secure=request.url.scheme == "https" or cfg.cookie_samesite == "none",
                        max_age=int(SESSION_IDLE.total_seconds()) * 16)
    return user


@app.post("/api/logout")
def logout(request: HttpRequest, response: Response):
    if token := request.cookies.get(COOKIE):
        with DB_LOCK:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (_hash(token),))
            db.commit()
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return user


@app.get("/api/meta")
def meta(user: dict = Depends(current_user)):
    from agents.knowledge import snapshot
    return {"occupations": len(snapshot()["occupations"]), "scenarios": SCENARIO_NOTES,
            "outlook": _outlook_meta(),
            "llm": (__import__("agents.llm", fromlist=["model_for"]).model_for("coach") or None) if cfg.llm_enabled else None}


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
        yield sse({"t": "meta", "route": out["route"], "status": out["status"], "plan_id": pid,
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
        return approval.list_plans(db, user)


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


@app.get("/api/plans/{pid}")
def plan(pid: str, user: dict = Depends(current_user)):
    _guard(pid, user)
    with DB_LOCK:
        cur, hist = approval.latest(db, pid), approval.history(db, pid)
        audience = db.execute("SELECT audience, subject_id FROM plans WHERE plan_id=?", (pid,)).fetchone()
    with DB_LOCK:
        saved = db.execute("SELECT report FROM plan_reports WHERE plan_id=?", (pid,)).fetchone()
        done = [r[0] for r in db.execute("SELECT item FROM plan_progress WHERE plan_id=?", (pid,))]
    report = json.loads(saved[0]) if saved else serialise(RESULTS[pid]) if pid in RESULTS else None
    return {"plan_id": pid, "audience": audience[0], "subject_id": audience[1], **cur, "history": hist, "report": report,
            "progress": done}


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
def team(body: TeamIn, user: dict = Depends(need("hr_advisor"))):
    reqs, errs = _parse(body)
    if errs:
        return JSONResponse({"detail": "invalid team file", "errors": errs}, status_code=422)

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
                pool.submit(worker, r)
            yield sse({"t": "roster", "ids": [r.employee_id for r in reqs],
                       "roles": {r.employee_id: occupation(r.target_role)["title"] for r in reqs}})
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
    return {"skills": [{"name": k, "level": v} for k, v in levels.items()], "matches": _matches(levels, prefixes, quiz.profile_text(body.answers, body.fields) or None, zone=body.zone, scenario=body.scenario)}


class MatchIn(BaseModel):
    skills: list[SkillIn] = Field(max_length=60)
    text: str | None = Field(default=None, max_length=20000)
    fields: list[str] = Field(default=[], max_length=13)
    scenario: str = Field(default="assistive", pattern="^(assistive|agentic)$")


@app.post("/api/match")
def match(body: MatchIn, user: dict = Depends(current_user)):
    _, prefixes = quiz.score({}, body.fields)
    return {"matches": _matches({s.name: s.level for s in body.skills}, prefixes, body.text, scenario=body.scenario)}


async def _read(file: UploadFile) -> bytes:
    data = await file.read(resume.MAX_BYTES + 1)
    if len(data) > resume.MAX_BYTES:
        raise HTTPException(413, "File too large (2 MB max).")
    return data


@app.post("/api/resume/analyze/stream")
async def resume_analyze_stream(file: UploadFile = File(...), user: dict = Depends(current_user)):
    """Same analysis as /api/resume/analyze, streamed: a progress event as each real stage starts, then the result."""
    data = await _read(file)
    name = file.filename or "resume.txt"
    events: queue.Queue = queue.Queue()

    def work():
        stage = lambda s: events.put({"t": "stage", "stage": s, "pct": RESUME_STAGES[s][0], "owl": RESUME_STAGES[s][1], "label": RESUME_STAGES[s][2]})
        try:
            events.put({"t": "result", "pct": 100, "data": _analyze_resume(name, data, stage)})
        except HTTPException as e:
            events.put({"t": "error", "message": e.detail})
        except Exception:
            log.exception("resume analysis failed")
            events.put({"t": "error", "message": "The analysis failed. Please try again."})
        events.put(None)

    def gen():
        threading.Thread(target=work, daemon=True).start()
        while (ev := events.get()) is not None:
            yield sse(ev)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/resume/analyze")
async def resume_analyze(file: UploadFile = File(...), user: dict = Depends(current_user)):
    """Resume -> Markdown -> evidence-backed skills -> future-role matches. Nothing is stored."""
    data = await _read(file)
    return await run_in_threadpool(_analyze_resume, file.filename or "resume.txt", data)


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
def opening_create(body: OpeningIn, user: dict = Depends(need("hr_advisor"))):
    o = occupation(body.soc)
    if not o:
        raise HTTPException(422, "Unknown occupation: pick one from the ESCO search.")
    c = criteria.parse(body.criteria_text, body.soc)
    try:
        with DB_LOCK:
            return recruiting.create_opening(db, user["username"], body.soc, body.title or o["title"], body.criteria_text, c)
    except ValueError as e:
        raise HTTPException(422, str(e))


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


@app.get("/")
def public_ui():
    return FileResponse(WEB / "index.html")


@app.get("/apply/{token}")
def apply_ui(token: str):  # old-style links -> the static page (token stays in the fragment, never in logs)
    return RedirectResponse(f"/apply.html#{token[:40]}", status_code=308)


@app.get("/enterprise")
def enterprise_ui():
    return FileResponse(WEB / "enterprise.html")


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
    """Fast path first (MCP knowledge tools + role list), then the slow MiniLM load."""
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


threading.Thread(target=_warm, daemon=True).start()
if cfg.signals_daily:
    threading.Thread(target=_daily, daemon=True).start()
