"""Additive SQLite persistence for employee-owned interview sessions."""
import json
from datetime import datetime, timezone


SCHEMA = """
CREATE TABLE IF NOT EXISTS interview_sessions (
    interview_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, role_id TEXT NOT NULL,
    role_title TEXT NOT NULL, difficulty TEXT NOT NULL, status TEXT NOT NULL,
    stage_index INTEGER NOT NULL DEFAULT 0, active_question_id TEXT,
    plan_id TEXT, profile_json TEXT NOT NULL, context_json TEXT NOT NULL,
    transcript_consent INTEGER NOT NULL, rubric_version TEXT NOT NULL,
    created_utc TEXT NOT NULL, completed_utc TEXT
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
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(con):
    con.executescript(SCHEMA)


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
    rows = con.execute("""SELECT s.interview_id, s.role_id, s.role_title, s.difficulty, s.status,
        s.created_utc, s.completed_utc, r.report_json FROM interview_sessions s
        LEFT JOIN interview_reports r USING(interview_id) WHERE s.employee_id=?
        ORDER BY s.created_utc DESC LIMIT ?""", (employee_id, limit)).fetchall()
    out = []
    for row in rows:
        item = dict(zip(("interview_id", "role_id", "role_title", "difficulty", "status", "created_utc", "completed_utc", "report_json"), row))
        result = json.loads(item.pop("report_json")) if item.get("report_json") else None
        item["performance"] = result.get("performance") if result else None
        item["readiness"] = result.get("readiness") if result else None
        item["competitiveness"] = result.get("competitiveness") if result else None
        out.append(item)
    return out
