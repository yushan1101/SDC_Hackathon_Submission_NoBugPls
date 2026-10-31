"""SQLite plan versions + append-only approval/validation events."""
import hashlib
import json
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans(plan_id TEXT PRIMARY KEY, subject_id TEXT, audience TEXT, created_utc TEXT);
CREATE TABLE IF NOT EXISTS analysis_employee_ids(number INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS plan_original_ids(plan_id TEXT PRIMARY KEY, original_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_references(number INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS plan_reference_overrides(plan_id TEXT PRIMARY KEY, number INTEGER NOT NULL);
INSERT INTO plan_references(plan_id)
    SELECT p.plan_id FROM plans p WHERE NOT EXISTS
        (SELECT 1 FROM plan_references r WHERE r.plan_id=p.plan_id)
    ORDER BY p.created_utc, p.plan_id;
CREATE TABLE IF NOT EXISTS plan_starts(plan_id TEXT PRIMARY KEY, start_utc TEXT NOT NULL);  -- the learner's own start date (default: created_utc)
CREATE TABLE IF NOT EXISTS plan_reports(plan_id TEXT PRIMARY KEY, report TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_edit_previews(token TEXT PRIMARY KEY, plan_id TEXT NOT NULL, base_version INTEGER NOT NULL,
    actor TEXT NOT NULL, plan_json TEXT NOT NULL, report_json TEXT NOT NULL, changes_json TEXT NOT NULL,
    created_utc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hr_reviews(plan_id TEXT PRIMARY KEY, candidate_name TEXT NOT NULL DEFAULT '',
    candidate_email TEXT NOT NULL DEFAULT '', candidate_phone TEXT NOT NULL DEFAULT '',
    reviewer_notes TEXT NOT NULL DEFAULT '', review_status TEXT,
    archived INTEGER NOT NULL DEFAULT 0, deleted_utc TEXT, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hr_review_events(id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL,
    actor TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, at_utc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hr_review_events_plan ON hr_review_events(plan_id, id);
CREATE TRIGGER IF NOT EXISTS hr_review_events_immutable BEFORE UPDATE ON hr_review_events
    BEGIN SELECT RAISE(ABORT, 'review events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS hr_review_events_retained BEFORE DELETE ON hr_review_events
    BEGIN SELECT RAISE(ABORT, 'review events must be retained'); END;
CREATE TABLE IF NOT EXISTS plan_versions(plan_id TEXT, version INTEGER, status TEXT, snapshot TEXT, sha256 TEXT,
    created_utc TEXT, PRIMARY KEY(plan_id, version));
CREATE TABLE IF NOT EXISTS approval_events(id INTEGER PRIMARY KEY, plan_id TEXT, version INTEGER, actor TEXT,
    actor_role TEXT, action TEXT, prev_status TEXT, new_status TEXT, at_utc TEXT);
CREATE TABLE IF NOT EXISTS validation_events(id INTEGER PRIMARY KEY, plan_id TEXT, version INTEGER, issues TEXT, at_utc TEXT);
CREATE TABLE IF NOT EXISTS workforce_team_plans(plan_id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_utc TEXT NOT NULL, plan_json TEXT NOT NULL, sample_preview INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS workforce_team_plans_owner ON workforce_team_plans(owner, created_utc);
CREATE TRIGGER IF NOT EXISTS versions_immutable BEFORE UPDATE ON plan_versions
    BEGIN SELECT RAISE(ABORT, 'plan versions are immutable'); END;
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str | None = None):
    """The app database: SQLite at `path`, or Postgres when AIVERSEPULSE_DATABASE_URL is set (governance/db.py)."""
    from governance import db
    con = db.connect(path)
    con.executescript(SCHEMA)
    return con


def snapshot(obj) -> tuple[str, str]:
    s = json.dumps(obj, sort_keys=True, default=str)
    return s, hashlib.sha256(s.encode()).hexdigest()
