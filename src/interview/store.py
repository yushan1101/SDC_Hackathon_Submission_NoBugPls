"""Additive SQLite persistence for employee-owned interview sessions."""
import json
import uuid
from datetime import datetime, timezone


SCHEMA = """
CREATE TABLE IF NOT EXISTS interview_sessions (
    interview_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, role_id TEXT NOT NULL,
    role_title TEXT NOT NULL, difficulty TEXT NOT NULL, status TEXT NOT NULL,
    stage_index INTEGER NOT NULL DEFAULT 0, active_question_id TEXT,
    plan_id TEXT, profile_json TEXT NOT NULL, context_json TEXT NOT NULL,
    transcript_consent INTEGER NOT NULL, rubric_version TEXT NOT NULL,
    created_utc TEXT NOT NULL, completed_utc TEXT,
    draft_answer TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS interview_sessions_owner ON interview_sessions(employee_id, created_utc);
CREATE TABLE IF NOT EXISTS interview_questions (
    question_id TEXT PRIMARY KEY, interview_id TEXT NOT NULL REFERENCES interview_sessions(interview_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, stage TEXT NOT NULL, question_type TEXT NOT NULL, difficulty TEXT NOT NULL,
    target_skills_json TEXT NOT NULL, source_refs_json TEXT NOT NULL, criteria_json TEXT NOT NULL,
    question_text TEXT NOT NULL, parent_question_id TEXT, created_utc TEXT NOT NULL,
    UNIQUE(interview_id, sequence)
);
CREATE TABLE IF NOT EXISTS interview_responses (
    question_id TEXT PRIMARY KEY REFERENCES interview_questions(question_id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL, evaluation_json TEXT NOT NULL, created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_reports (
    interview_id TEXT PRIMARY KEY REFERENCES interview_sessions(interview_id) ON DELETE CASCADE,
    report_json TEXT NOT NULL, created_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interview_access_assessments (
    assessment_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('resume', 'questionnaire')),
    parent_assessment_id TEXT, created_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS interview_access_assessments_owner
    ON interview_access_assessments(employee_id, created_utc);
CREATE TABLE IF NOT EXISTS interview_access_recommendations (
    recommendation_id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL,
    employee_id TEXT NOT NULL, role_id TEXT NOT NULL, role_title TEXT NOT NULL,
    profile_json TEXT NOT NULL, created_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS interview_access_recommendations_owner
    ON interview_access_recommendations(employee_id, recommendation_id);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(con):
    con.executescript(SCHEMA)
    columns = {row[1] for row in con.execute("PRAGMA table_info(interview_sessions)")}
    if "recommendation_id" not in columns:
        con.execute("ALTER TABLE interview_sessions ADD COLUMN recommendation_id TEXT")
    if "assessment_source" not in columns:
        con.execute("ALTER TABLE interview_sessions ADD COLUMN assessment_source TEXT")
    if "draft_answer" not in columns:
        con.execute("ALTER TABLE interview_sessions ADD COLUMN draft_answer TEXT NOT NULL DEFAULT ''")


def json_dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def session(con, interview_id, employee_id):
    row = con.execute("SELECT * FROM interview_sessions WHERE interview_id=? AND employee_id=?",
                      (interview_id, employee_id)).fetchone()
    if not row:
        return None
    cols = [c[0] for c in con.execute("SELECT * FROM interview_sessions LIMIT 0").description]
    d = dict(zip(cols, row))
    d["profile"] = json.loads(d.pop("profile_json"))
    d["context"] = json.loads(d.pop("context_json"))
    return d


def question(con, question_id):
    row = con.execute("SELECT * FROM interview_questions WHERE question_id=?", (question_id,)).fetchone()
    if not row:
        return None
    cols = [c[0] for c in con.execute("SELECT * FROM interview_questions LIMIT 0").description]
    d = dict(zip(cols, row))
    for column, key in (("target_skills_json", "target_skills"), ("source_refs_json", "source_refs"), ("criteria_json", "criteria")):
        d[key] = json.loads(d.pop(column))
    return d


def report(con, interview_id):
    row = con.execute("SELECT report_json FROM interview_reports WHERE interview_id=?", (interview_id,)).fetchone()
    return json.loads(row[0]) if row else None


def history(con, employee_id, limit=30):
    rows = con.execute("""SELECT s.interview_id, s.role_id, s.role_title, s.difficulty, s.status, s.stage_index,
        s.created_utc, s.completed_utc, r.report_json, s.assessment_source,
        (SELECT count(*) FROM interview_responses x JOIN interview_questions q USING(question_id)
            WHERE q.interview_id=s.interview_id) AS answered_count FROM interview_sessions s
        LEFT JOIN interview_reports r USING(interview_id) WHERE s.employee_id=?
        ORDER BY s.created_utc DESC LIMIT ?""", (employee_id, limit)).fetchall()
    out = []
    for row in rows:
        item = dict(zip(("interview_id", "role_id", "role_title", "difficulty", "status", "stage_index", "created_utc", "completed_utc", "report_json", "assessment_source", "answered_count"), row))
        result = json.loads(item.pop("report_json")) if item.get("report_json") else None
        item["interview_type"] = "AI mock interview"
        item["performance"] = result.get("performance") if result else None
        item["readiness"] = result.get("readiness") if result else None
        item["competitiveness"] = result.get("competitiveness") if result else None
        item["question_number"] = item.pop("answered_count") + 1
        item["total_stages"] = 5
        out.append(item)
    return out


def save_recommendations(con, employee_id, source, profile, matches, parent_assessment_id=None):
    """Persist only assessment-derived skill summaries and role recommendations, never a raw resume."""
    if source not in ("resume", "questionnaire"):
        return None
    if parent_assessment_id and not valid_assessment(con, parent_assessment_id, employee_id, source="resume"):
        return None
    safe_profile = [{"name": str(s["name"]).strip(), "level": int(s["level"])} for s in profile
                    if str(s.get("name", "")).strip()][:40]
    if not safe_profile:
        return None
    assessment_id, created = uuid.uuid4().hex, now()
    con.execute("INSERT INTO interview_access_assessments VALUES(?,?,?,?,?)",
                (assessment_id, employee_id, source, parent_assessment_id, created))
    for match in matches or []:
        role_id, role_title = str(match.get("soc", "")), str(match.get("title", ""))
        if not role_id or not role_title:
            continue
        recommendation_id = uuid.uuid4().hex
        con.execute("""INSERT INTO interview_access_recommendations
            VALUES(?,?,?,?,?,?,?)""", (recommendation_id, assessment_id, employee_id,
                role_id, role_title, json_dump(safe_profile), created))
        match["recommendation_id"] = recommendation_id
        match["assessment_source"] = source
    return assessment_id


def valid_assessment(con, assessment_id, employee_id, source=None):
    query = "SELECT 1 FROM interview_access_assessments WHERE assessment_id=? AND employee_id=?"
    args = [assessment_id, employee_id]
    if source:
        query += " AND source=?"
        args.append(source)
    return con.execute(query, args).fetchone() is not None


def recommendation(con, recommendation_id, employee_id):
    row = con.execute("""SELECT r.recommendation_id, r.assessment_id, a.source, r.role_id,
        r.role_title, r.profile_json, r.created_utc FROM interview_access_recommendations r
        JOIN interview_access_assessments a ON a.assessment_id=r.assessment_id
        WHERE r.recommendation_id=? AND r.employee_id=? AND a.employee_id=?""",
        (recommendation_id, employee_id, employee_id)).fetchone()
    if not row:
        return None
    return {"recommendation_id": row[0], "assessment_id": row[1], "source": row[2], "role_id": row[3],
            "role_title": row[4], "profile": json.loads(row[5]), "created_utc": row[6]}
