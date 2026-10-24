"""Small compatibility wrapper for the application's PostgreSQL connection.

SQLite remains the local fallback for clones without Replit's managed database.
PostgreSQL schemas are provisioned by the migration/publish flow, never on app
startup.
"""
from __future__ import annotations

import re
import threading


_REPLACE_KEYS = {
    "email_otp": ("username",),
    "frontend_sites": ("origin",),
    "hr_reviews": ("plan_id",),
    "interview_reports": ("interview_id",),
    "model_catalog": ("spec",),
    "org_models": ("owner", "task"),
    "plan_progress": ("plan_id", "item"),
    "plan_reference_overrides": ("plan_id",),
    "plan_reports": ("plan_id",),
    "signal_boards": ("day",),
    "signal_counts": ("day", "source", "topic", "window"),
    "signup_waits": ("username",),
}

_REPLACE_COLUMNS = {
    "email_otp": ("username", "code_hash", "expires_utc", "tries", "link_hash"),
    "frontend_sites": ("origin", "label", "added_by", "created_utc"),
    "interview_reports": ("interview_id", "report_json", "created_utc"),
    "model_catalog": ("spec", "label", "created_utc"),
    "org_models": ("owner", "task", "spec"),
    "plan_progress": ("plan_id", "item", "done_utc"),
    "plan_reference_overrides": ("plan_id", "number"),
    "plan_reports": ("plan_id", "report"),
    "signal_boards": ("day", "board", "created_utc"),
    "signal_counts": ("day", "source", "topic", "window", "value", "n", "url", "fetched_utc"),
    "signup_waits": ("username", "token_hash", "expires_utc", "claimed"),
}


def _convert_qmarks(sql: str) -> str:
    """Translate SQLite's positional `?` markers without touching quoted text."""
    result: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(sql):
        char = sql[i]
        if quote:
            result.append(char)
            if char == quote:
                if i + 1 < len(sql) and sql[i + 1] == quote:
                    result.append(sql[i + 1])
                    i += 1
                else:
                    quote = None
        elif char in ("'", '"', "`"):
            quote = char
            result.append(char)
        elif char == "-" and i + 1 < len(sql) and sql[i + 1] == "-":
            end = sql.find("\n", i)
            if end == -1:
                result.append(sql[i:])
                break
            result.append(sql[i:end + 1])
            i = end
        elif char == "/" and i + 1 < len(sql) and sql[i + 1] == "*":
            end = sql.find("*/", i + 2)
            if end == -1:
                result.append(sql[i:])
                break
            result.append(sql[i:end + 2])
            i = end + 1
        elif char.isalpha() or char == "_":
            end = i + 1
            while end < len(sql) and (sql[end].isalnum() or sql[end] == "_"):
                end += 1
            identifier = sql[i:end]
            result.append('"window"' if identifier.lower() == "window" else identifier)
            i = end - 1
        elif char == "?":
            result.append("%s")
        else:
            result.append(char)
        i += 1
    return "".join(result)


def _adapt_sql(sql: str) -> str:
    statement = sql.strip().rstrip(";")
    statement = re.sub(
        r"json_extract\(\s*([A-Za-z_][A-Za-z_0-9.]*)\s*,\s*'\$\.([A-Za-z_][A-Za-z_0-9]*)'\s*\)",
        r"(\1::jsonb #>> '{\2}')",
        statement,
        flags=re.I,
    )
    ignore = re.match(r"INSERT\s+OR\s+IGNORE\s+INTO\s+", statement, re.I)
    if ignore:
        statement = statement[ignore.end():]
        statement = "INSERT INTO " + statement + " ON CONFLICT DO NOTHING"

    replace = re.match(
        r"INSERT\s+OR\s+REPLACE\s+INTO\s+([A-Za-z_][A-Za-z_0-9]*)"
        r"(?:\s*\(([^)]*)\))?",
        statement,
        re.I,
    )
    if replace:
        table = replace.group(1).lower()
        keys = _REPLACE_KEYS.get(table)
        if not keys:
            raise ValueError(f"No PostgreSQL upsert key configured for {table}")
        explicit_columns = replace.group(2)
        if explicit_columns:
            columns = tuple(c.strip().strip('"') for c in explicit_columns.split(","))
            prefix = re.sub(r"^INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", statement, count=1, flags=re.I)
        else:
            columns = _REPLACE_COLUMNS.get(table)
            if not columns:
                raise ValueError(f"No PostgreSQL column order configured for {table}")
            prefix = re.sub(r"^INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", statement, count=1, flags=re.I)
            prefix = prefix.replace(replace.group(1), f"{replace.group(1)}({','.join(columns)})", 1)
        if not set(keys).issubset(columns):
            raise ValueError(f"Missing PostgreSQL upsert key column for {table}")
        update_columns = [c for c in columns if c not in keys]
        if update_columns:
            conflict = f" ON CONFLICT ({','.join(keys)}) DO UPDATE SET " + ",".join(
                f"{column}=EXCLUDED.{column}" for column in update_columns
            )
        else:
            conflict = f" ON CONFLICT ({','.join(keys)}) DO NOTHING"
        statement = prefix + conflict

    return _convert_qmarks(statement)


class PostgresConnection:
    """Expose the subset of sqlite3.Connection used by this application."""

    backend = "postgres"

    def __init__(self, connection):
        self._connection = connection
        self._lock = threading.RLock()
        self._tx_local = threading.local()

    def execute(self, sql: str, parameters=()):
        with self._lock:
            statement = _adapt_sql(sql)
            if not parameters:
                return self._connection.execute(statement)
            return self._connection.execute(statement, parameters)

    def executemany(self, sql: str, parameters):
        with self._lock:
            return self._connection.executemany(_adapt_sql(sql), parameters)

    def commit(self):
        # Outside an explicit `with connection:` block, statements use
        # autocommit to match the application's SQLite connection behavior.
        if not self._connection.autocommit:
            with self._lock:
                self._connection.commit()

    def rollback(self):
        if not self._connection.autocommit:
            with self._lock:
                self._connection.rollback()

    def executescript(self, _script: str):
        raise RuntimeError(
            "PostgreSQL schema changes must be applied to development and published "
            "through Replit's database migration flow; app-startup DDL is disabled."
        )

    def __enter__(self):
        self._lock.acquire()
        try:
            transaction = self._connection.transaction()
            transaction.__enter__()
            stack = getattr(self._tx_local, "stack", [])
            stack.append(transaction)
            self._tx_local.stack = stack
            return self
        except Exception:
            self._lock.release()
            raise

    def __exit__(self, exc_type, exc, tb):
        try:
            transaction = self._tx_local.stack.pop()
            return transaction.__exit__(exc_type, exc, tb)
        finally:
            self._lock.release()

    def __getattr__(self, name):
        return getattr(self._connection, name)


def connect(url: str) -> PostgresConnection:
    import psycopg

    return PostgresConnection(psycopg.connect(url, connect_timeout=10, autocommit=True))
