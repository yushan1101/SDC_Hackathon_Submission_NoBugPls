"""Recruiting store: openings (with NL criteria), resume applications, and an append-only decision log.

Privacy by design: raw files are never stored (Markdown only); reviewers see the redacted Markdown; candidate
contact details unlock only after a human HR advisor shortlists. AI agents recommend; humans decide.
"""
import json
import secrets
import uuid

from governance.audit import now

SCHEMA = """
CREATE TABLE IF NOT EXISTS openings(id TEXT PRIMARY KEY, owner TEXT, soc TEXT, title TEXT, criteria_text TEXT,
    criteria TEXT, status TEXT, token TEXT UNIQUE, created_utc TEXT);
CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, opening_id TEXT, ref TEXT, contact TEXT, resume_md TEXT,
    redacted_md TEXT, analysis TEXT, fit REAL, recommended INTEGER, status TEXT, created_utc TEXT);
CREATE TABLE IF NOT EXISTS recruiting_events(id INTEGER PRIMARY KEY, opening_id TEXT, application_id TEXT,
    actor TEXT, action TEXT, detail TEXT, at_utc TEXT);
"""
DECISIONS = {"shortlisted", "declined", "on_hold"}
MAX_APPLICATIONS = 1000


def init(con):
    con.executescript(SCHEMA)
    return con


def _event(con, opening_id, app_id, actor, action, detail=""):
    con.execute("INSERT INTO recruiting_events(opening_id,application_id,actor,action,detail,at_utc) VALUES(?,?,?,?,?,?)",
                (opening_id, app_id, actor, action, detail, now()))


def create_opening(con, owner: str, soc: str, title: str, criteria_text: str, criteria: dict) -> dict:
    if criteria.get("blocked"):
        raise ValueError("criteria reference protected characteristics: " + ", ".join(criteria["blocked"]))
    oid, token = uuid.uuid4().hex[:10], secrets.token_urlsafe(12)
    with con:
        con.execute("INSERT INTO openings VALUES(?,?,?,?,?,?,?,?,?)",
                    (oid, owner, soc, title, criteria_text, json.dumps(criteria), "open", token, now()))
        _event(con, oid, None, owner, "opening_created", criteria_text)
    return get_opening(con, oid)


def update_criteria(con, oid: str, actor: str, criteria_text: str, criteria: dict):
    if criteria.get("blocked"):
        raise ValueError("criteria reference protected characteristics: " + ", ".join(criteria["blocked"]))
    with con:
        con.execute("UPDATE openings SET criteria_text=?, criteria=? WHERE id=?", (criteria_text, json.dumps(criteria), oid))
        _event(con, oid, None, actor, "criteria_updated", criteria_text)


def set_status(con, oid: str, actor: str, status: str):
    with con:
        con.execute("UPDATE openings SET status=? WHERE id=?", (status, oid))
        _event(con, oid, None, actor, f"opening_{status}")


def _opening(row) -> dict:
    keys = ["id", "owner", "soc", "title", "criteria_text", "criteria", "status", "token", "created_utc"]
    d = dict(zip(keys, row))
    d["criteria"] = json.loads(d["criteria"] or "{}")
    return d


def get_opening(con, oid: str | None = None, token: str | None = None) -> dict | None:
    row = con.execute("SELECT * FROM openings WHERE " + ("id=?" if oid else "token=?"), (oid or token,)).fetchone()
    return _opening(row) if row else None


def list_openings(con) -> list[dict]:
    rows = con.execute("SELECT * FROM openings ORDER BY created_utc DESC").fetchall()
    out = []
    for r in rows:
        o = _opening(r)
        o["applications"] = con.execute("SELECT count(*), sum(recommended) FROM applications WHERE opening_id=?", (o["id"],)).fetchone()
        out.append(o)
    return out


def add_application(con, opening_id: str, contact: dict, resume_md: str, redacted_md: str, analysis: dict) -> str:
    n = con.execute("SELECT count(*) FROM applications WHERE opening_id=?", (opening_id,)).fetchone()[0]
    if n >= MAX_APPLICATIONS:
        raise ValueError("this opening is no longer accepting applications")
    aid = uuid.uuid4().hex[:12]
    with con:
        con.execute("INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (aid, opening_id, f"C-{n + 1:04d}", json.dumps(contact), resume_md, redacted_md, json.dumps(analysis),
                     analysis.get("fit", 0.0), 0, "new", now()))
        _event(con, opening_id, aid, "screening-agents", "application_screened", f"fit {analysis.get('fit', 0):.2f}")
    return aid


def update_analysis(con, app_id: str, analysis: dict):
    with con:
        con.execute("UPDATE applications SET analysis=?, fit=? WHERE id=?", (json.dumps(analysis), analysis.get("fit", 0.0), app_id))


def resumes(con, opening_id: str) -> list[tuple[str, str]]:
    return con.execute("SELECT id, resume_md FROM applications WHERE opening_id=?", (opening_id,)).fetchall()


def set_recommendations(con, opening_id: str, recommended_ids: list[str]):
    cur = {r[0] for r in con.execute("SELECT id FROM applications WHERE opening_id=? AND recommended=1", (opening_id,))}
    if cur == set(recommended_ids):
        return
    with con:
        con.execute("UPDATE applications SET recommended=0 WHERE opening_id=?", (opening_id,))
        for aid in recommended_ids:
            con.execute("UPDATE applications SET recommended=1 WHERE id=?", (aid,))
        _event(con, opening_id, None, "ranking-agent", "recommendations_updated", json.dumps(recommended_ids))


def list_applications(con, opening_id: str, reveal: bool = False) -> list[dict]:
    rows = con.execute("SELECT id, ref, contact, redacted_md, analysis, fit, recommended, status, created_utc "
                       "FROM applications WHERE opening_id=? ORDER BY fit DESC", (opening_id,)).fetchall()
    out = []
    for aid, ref, contact, red, analysis, fit, rec, status, created in rows:
        a = {"id": aid, "ref": ref, "redacted_md": red, "analysis": json.loads(analysis), "fit": fit,
             "recommended": bool(rec), "status": status, "created_utc": created}
        if status == "shortlisted" or reveal:  # contact unlocks only after a human shortlists
            a["contact"] = json.loads(contact or "{}")
        out.append(a)
    return out


def decide(con, app_id: str, actor: str, decision: str, note: str = "") -> dict:
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {sorted(DECISIONS)}")
    if not actor:
        raise ValueError("a named HR advisor must make the decision")
    row = con.execute("SELECT opening_id, status FROM applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        raise ValueError("application not found")
    with con:
        con.execute("UPDATE applications SET status=? WHERE id=?", (decision, app_id))
        _event(con, row[0], app_id, actor, f"human_{decision}", note[:500])
    return {"id": app_id, "status": decision}


def events(con, opening_id: str) -> list[dict]:
    cols = ["application_id", "actor", "action", "detail", "at_utc"]
    return [dict(zip(cols, r)) for r in con.execute(
        f"SELECT {','.join(cols)} FROM recruiting_events WHERE opening_id=? ORDER BY id", (opening_id,))]
