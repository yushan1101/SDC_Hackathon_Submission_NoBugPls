"""SQLite plan versions + append-only approval/validation events."""
import hashlib
import json
import os
import sqlite3
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
    ORDER BY p.created_utc, p.rowid;
CREATE TABLE IF NOT EXISTS plan_reports(plan_id TEXT PRIMARY KEY, report TEXT NOT NULL);
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
CREATE TRIGGER IF NOT EXISTS versions_immutable BEFORE UPDATE ON plan_versions
    BEGIN SELECT RAISE(ABORT, 'plan versions are immutable'); END;
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str | None = None) -> sqlite3.Connection:
    from config.settings import get_settings
    backend = os.environ.get("DATABASE_BACKEND", "sqlite").strip().lower()
    if backend == "postgres":
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_BACKEND=postgres but Replit did not provide DATABASE_URL")
        from governance.postgres import connect as connect_postgres
        return connect_postgres(url)
    if backend != "sqlite":
        raise RuntimeError("DATABASE_BACKEND must be either 'sqlite' or 'postgres'")
    path = path or get_settings().database_path
    if path != ":memory:":
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    con = sqlite3.connect(path, check_same_thread=False)
    con.executescript(SCHEMA)
    return con


def is_postgres(con) -> bool:
    return getattr(con, "backend", "sqlite") == "postgres"


def snapshot(obj) -> tuple[str, str]:
    s = json.dumps(obj, sort_keys=True, default=str)
    return s, hashlib.sha256(s.encode()).hexdigest()
