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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Request as HttpRequest, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from agents.gap_analyst import SCENARIO_NOTES
from agents.pathway import HOURS_PER_LEVEL
from agents.knowledge import known_skills, search_role_skills
from config.settings import get_settings
from core import graph
from core.state import Pathway, Profile, Request, Skill
from core.team_import import parse_team
from core.usage import summarize
from governance import accounts, approval
from governance.audit import connect
from mcp_server.ingest import ROLE_SOC
from validation.revision import validate

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
cfg = get_settings()
db = accounts.init(connect(cfg.database_path))
DB_LOCK = threading.Lock()  # one sqlite connection shared across request threads
SESSION_IDLE = timedelta(minutes=30)
COOKIE = "ap_session"
RESULTS: "OrderedDict[str, dict]" = OrderedDict()  # plan_id -> last run, to re-validate edits (bounded)

with DB_LOCK:
    db.executescript("""CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT, role TEXT,
                        employee_id TEXT, display_name TEXT, expires_utc TEXT);""")

app = FastAPI(title="AiversePulse", docs_url=None, redoc_url=None, openapi_url=None)


# --- security -------------------------------------------------------------------------------------
@app.middleware("http")
async def headers(request: HttpRequest, call_next):
    if request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith("/api/") \
            and request.headers.get("x-ap") != "1":  # custom header => cross-site forms can't post (CSRF)
        return JSONResponse({"detail": "missing X-AP header"}, status_code=403)
    resp = await call_next(request)
    resp.headers.update({
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' "
                                   "https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; "
                                   "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()"})
    if request.url.path.startswith("/static/") or request.url.path in ("/", "/enterprise"):
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
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=request.url.scheme == "https",
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
    roles = sorted(r for r in ROLE_SOC if search_role_skills(r)[0])
    return {"roles": roles, "skills": sorted(known_skills()), "scenarios": SCENARIO_NOTES,
            "llm": cfg.llm_fast_model if cfg.llm_enabled else None}


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
        return f"Retrieved {n} dated sources ({u.get('retrieval', {}).get('retrieval_mode', 'n/a')})"
    if node == "gap_analysis":
        return f"Scored {sum(g.gap > 0 for g in u.get('skill_gaps', []))} gaps under both AI scenarios"
    if node == "market_analyst":
        f = u.get("forecast")
        return f"Forecast {f.get('skill_id')} with {f.get('model_id')}" if f and f.get("model_id") else "Forecast skipped"
    if node == "pathway":
        p = u.get("draft_pathway")
        return f"Drafted {len(p.activities)} activities across 90 days" if p else "Drafted plan"
    if node == "coach":
        return "Wrote summary (" + ("AI" if u.get("narrative_mode") == "llm" else "template") + ")"
    if node == "reviewer":
        return f"Verified citations and workload · {u.get('revision_count', 0)} repairs"
    if node == "simple_lookup":
        return "Looked up job-ad facts"
    return node


def serialise(s: dict) -> dict:
    p = s.get("draft_pathway")
    flags = s.get("skill_flags", {})
    return {"route": s.get("route"), "route_reason": s.get("route_reason"), "answer": s.get("answer"),
            "status": s.get("status"), "narrative": s.get("narrative", ""), "narrative_mode": s.get("narrative_mode"),
            "gaps": [g.model_dump() | {"onet_hot": flags.get(g.skill_id, {}).get("onet_hot", False)}
                     for g in s.get("skill_gaps", [])],
            "comparison": s.get("scenario_comparison", []),
            "evidence": [e.model_dump() for e in s.get("evidence", [])],
            "forecast": s.get("forecast"), "plan": p.model_dump() if p else None,
            "issues": [i.model_dump() for i in s.get("validation_issues", [])],
            "retrieval": s.get("retrieval", {}), "usage": summarize(s.get("usage", [])),
            "revision_count": s.get("revision_count", 0)}


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def remember(pid: str, state: dict):
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
    forecast: bool = False


@app.post("/api/analyze")
def analyze(body: AnalyzeIn, user: dict = Depends(need("employee"))):
    try:
        req = Request(request_id=uuid.uuid4().hex[:8], audience="individual", employee_id=user["employee_id"],
                      target_role=body.target_role, scenario=body.scenario,
                      query=body.query + (" forecast" if body.forecast else ""),
                      profile=Profile(weekly_learning_hours=body.weekly_learning_hours,
                                      skills=[Skill(name=s.name, level=s.level) for s in body.skills]))
    except ValidationError as e:
        raise HTTPException(422, str(e).splitlines()[0])

    def gen():
        t0 = time.perf_counter()
        yield sse({"t": "owl", "state": "thinking", "say": "Reading your request"})
        final = None
        try:
            for kind, node, upd in graph.stream(req):
                if kind == "update":
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
        pid = None
        if out["route"] == "complex":
            with DB_LOCK:
                pid = approval.create(db, out["plan"], user["employee_id"], "individual", out["issues"])
            remember(pid, final)
        yield sse({"t": "meta", "route": out["route"], "status": out["status"], "plan_id": pid,
                   "usage": out["usage"], "retrieval": out["retrieval"], "evidence": out["evidence"],
                   "target_role": req.target_role, "scenario": req.scenario})
        yield sse({"t": "owl", "state": "update", "say": "Writing your briefing"})
        for piece in chunks(out["narrative"] or out["answer"] or ""):
            yield sse({"t": "text", "delta": piece})
            time.sleep(0.03)  # presentation pacing of already-verified text
        for kind in ("gaps", "comparison", "forecast", "issues", "plan"):
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


@app.get("/api/plans/{pid}")
def plan(pid: str, user: dict = Depends(current_user)):
    _guard(pid, user)
    with DB_LOCK:
        cur, hist = approval.latest(db, pid), approval.history(db, pid)
        audience = db.execute("SELECT audience, subject_id FROM plans WHERE plan_id=?", (pid,)).fetchone()
    report = serialise(RESULTS[pid]) if pid in RESULTS else None
    return {"plan_id": pid, "audience": audience[0], "subject_id": audience[1], **cur, "history": hist, "report": report}


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
    forecast: bool = False


@app.post("/api/team/validate")
def team_validate(body: TeamIn, user: dict = Depends(need("hr_advisor"))):
    reqs, errs = _parse(body)
    return {"employees": len(reqs), "errors": errs}


def _parse(body: TeamIn):
    try:
        df = pd.read_csv(StringIO(body.csv))
    except Exception:
        return [], ["could not read CSV"]
    roles = {r for r in ROLE_SOC if search_role_skills(r)[0]}
    return parse_team(df, roles, body.scenario, body.forecast, cfg.max_upload_rows, cfg.max_team_size)


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
                       "roles": {r.employee_id: r.target_role for r in reqs}})
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
                yield sse({"t": "employee", "id": r.employee_id, "plan_id": pid, "role": r.target_role,
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


@app.get("/api/public/specimen")
def specimen():
    """Real, public aggregate shown on the sign-in page (no auth): top skills in 2023 Data Analyst ads."""
    skills, ev, _ = search_role_skills("Data Analyst")
    return {"role": "Data Analyst", "skills": list(skills.items())[:5],
            "postings": next((e.excerpt.split(" of ")[1].split(" ")[0] for e in ev if " of " in e.excerpt), None),
            "source": ev[0].title if ev else None, "url": ev[0].url if ev else None}


@app.get("/api/sample-team")
def sample_team(user: dict = Depends(need("hr_advisor"))):
    return {"csv": (ROOT / "data" / "samples" / "sample_team.csv").read_text(encoding="utf-8")}


# --- static UI --------------------------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def public_ui():
    return FileResponse(WEB / "index.html")


@app.get("/enterprise")
def enterprise_ui():
    return FileResponse(WEB / "enterprise.html")


@app.get("/healthz")
def health():
    return {"ok": True}


def _warm():
    """Fast path first (MCP knowledge tools + role list), then the slow MiniLM load."""
    try:
        for r in ROLE_SOC:
            search_role_skills(r)
        from mcp_server.retrieval import warm
        warm()
    except Exception:
        log.exception("warm-up failed; vector search stays on the offline snapshot")


threading.Thread(target=_warm, daemon=True).start()
