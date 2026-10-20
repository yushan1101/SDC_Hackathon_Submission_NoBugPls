"""SQLite plan versions + append-only approval/validation events."""
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans(plan_id TEXT PRIMARY KEY, subject_id TEXT, audience TEXT, created_utc TEXT);
CREATE TABLE IF NOT EXISTS plan_reports(plan_id TEXT PRIMARY KEY, report TEXT NOT NULL);
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
    path = path or os.getenv("DATABASE_PATH", "data/audit.sqlite3")
    if path != ":memory:":
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    con = sqlite3.connect(path, check_same_thread=False)
    con.executescript(SCHEMA)
    return con


def snapshot(obj) -> tuple[str, str]:
    s = json.dumps(obj, sort_keys=True, default=str)
    return s, hashlib.sha256(s.encode()).hexdigest()
