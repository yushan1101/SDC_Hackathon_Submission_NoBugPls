"""One database connection for the whole app: SQLite (default) or Postgres (AIVERSEPULSE_DATABASE_URL set, several app nodes).

The app's SQL is written for sqlite3. On Postgres, `PgConnection` takes the same calls and translates the few things that
differ, so call sites stay unchanged:
  - `?` placeholders -> `%s`; `bool` parameters -> 0/1 (columns are INTEGER, as in SQLite)
  - DDL in `executescript`: INTEGER -> BIGINT, `INTEGER PRIMARY KEY` -> identity, REAL -> DOUBLE PRECISION,
    BLOB -> BYTEA, and `RAISE(ABORT, ...)` triggers -> plpgsql trigger functions
  - `PRAGMA table_info(t)` -> information_schema (same row shape: cid, name, type, notnull, default, pk)
  - transactions as in sqlite3's legacy mode: a write opens one, `commit()`/`rollback()` or `with con:` end it
  - errors are raised as `sqlite3.IntegrityError` / `OperationalError`, so existing `except` clauses keep working
SQL that differs in meaning (upserts, JSON, case-insensitive LIKE) is written portably at the call site, using
`json_text()` below where needed.
"""
import hashlib
import logging
import os
import re
import sqlite3
import uuid
from functools import lru_cache

log = logging.getLogger(__name__)
DML = re.compile(r"^\s*(INSERT|UPDATE|DELETE|REPLACE)\b", re.I)
_LITERAL = re.compile(r"('(?:[^']|'')*')")  # single-quoted SQL strings: leave their contents alone
_PRAGMA = re.compile(r"^\s*PRAGMA\s+table_info\((\w+)\)\s*;?\s*$", re.I)
_TRIGGER = re.compile(r"CREATE TRIGGER IF NOT EXISTS (\w+)\s+(BEFORE|AFTER)\s+(UPDATE|DELETE|INSERT)\s+ON\s+(\w+)\s+"
                      r"BEGIN\s+SELECT\s+RAISE\(ABORT,\s*'([^']*)'\);\s*END;?", re.I | re.S)


def _settings():
    from config.settings import get_settings
    return get_settings()


def postgres_url() -> str | None:
    """Return the app-specific Postgres URL, with an explicit Replit backend opt-in fallback.

    Hosts may expose their own DATABASE_URL. It is ignored unless DATABASE_BACKEND=postgres
    explicitly selects it; AIVERSEPULSE_DATABASE_URL always takes precedence.
    """
    s = _settings()
    backend = os.environ.get("DATABASE_BACKEND", "").strip().lower()
    if backend not in {"", "sqlite", "postgres"}:
        raise RuntimeError("DATABASE_BACKEND must be either 'sqlite' or 'postgres'")
    if backend == "sqlite":
        return None
    if s.database_url:
        return s.database_url.get_secret_value()
    if backend == "postgres":
        return os.environ.get("DATABASE_URL") or None
    return None


def connect(path: str | None = None):
    """Postgres via AIVERSEPULSE_DATABASE_URL (or explicitly selected DATABASE_URL), else SQLite."""
    s = _settings()
    url = postgres_url()
    if url:
        return PgConnection(url, _schema(path, s))
    if os.environ.get("DATABASE_BACKEND", "").strip().lower() == "postgres":
        raise RuntimeError("DATABASE_BACKEND=postgres but no PostgreSQL URL is available")
    path = path or s.database_path
    if path != ":memory:":
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    return sqlite3.connect(path, check_same_thread=False)


def _schema(path, s) -> str:
    """Postgres schema for a database `path`. The app's own database is `public`, on every node. Tests set
    AP_PG_SCHEMA_PER_PATH=1 so each temporary database path gets its own schema, isolated like separate files."""
    if path == ":memory:":
        return "m_" + uuid.uuid4().hex[:16]
    if os.environ.get("AP_PG_SCHEMA_PER_PATH"):
        return "p_" + _hash(path or s.database_path)
    return "public"


def _hash(path) -> str:
    return hashlib.sha1(os.path.abspath(str(path)).encode()).hexdigest()[:16]


def is_postgres(con) -> bool:
    return isinstance(con, PgConnection)


def json_text(con, column: str, key: str) -> str:
    """SQL for the text value of top-level JSON key `key` in a TEXT column."""
    return f"({column}::jsonb ->> '{key}')" if is_postgres(con) else f"json_extract({column}, '$.{key}')"


def no_wait(con):
    """Call inside a write transaction that need not wait for the standby (session refreshes, usage counters, trend
    counts): on Postgres it commits once the primary has it, instead of after the round trip to the standby.
    Losing it in a primary crash costs nothing that matters. No-op on SQLite."""
    if is_postgres(con) and con.in_transaction:
        con.execute("SET LOCAL synchronous_commit = local")


def tables(con) -> set[str]:
    if is_postgres(con):
        return {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")}
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def translate(sql: str) -> str:
    """`?` -> `%s` outside string literals; literal `%` doubled (psycopg treats `%` as a placeholder marker)."""
    parts = _LITERAL.split(sql)
    for i in range(0, len(parts), 2):
        parts[i] = parts[i].replace("%", "%%").replace("?", "%s")
    for i in range(1, len(parts), 2):
        parts[i] = parts[i].replace("%", "%%")
    return "".join(parts)


def ddl(script: str) -> str:
    """SQLite DDL -> Postgres DDL (the subset this app uses)."""
    def trigger(m):
        name, when, event, table, message = m.groups()
        message = message.replace("'", "''")
        return (f"CREATE OR REPLACE FUNCTION {name}_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN "
                f"RAISE EXCEPTION '{message}' USING ERRCODE = '23000'; END $f$;\n"
                f"CREATE OR REPLACE TRIGGER {name} {when} {event} ON {table} FOR EACH ROW EXECUTE FUNCTION {name}_fn();")
    script = _TRIGGER.sub(trigger, script)
    script = re.sub(r"\bINTEGER\s+PRIMARY\s+KEY(\s+AUTOINCREMENT)?\b", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
                    script, flags=re.I)
    script = re.sub(r"\bINTEGER\b", "BIGINT", script, flags=re.I)
    script = re.sub(r"\bREAL\b", "DOUBLE PRECISION", script, flags=re.I)
    return re.sub(r"\bBLOB\b", "BYTEA", script, flags=re.I)


def _params(params):
    if isinstance(params, dict):
        raise TypeError("named parameters are not supported; use ? placeholders")
    return tuple(int(p) if isinstance(p, bool) else p for p in params)


def _as_sqlite_error(e):
    import psycopg
    state = getattr(e, "sqlstate", None) or ""
    if state.startswith("23"):
        return sqlite3.IntegrityError(str(e).strip())
    if isinstance(e, (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn, psycopg.errors.SyntaxError)):
        return sqlite3.OperationalError(str(e).strip())
    return sqlite3.OperationalError(str(e).strip()) if isinstance(e, psycopg.OperationalError) else sqlite3.DatabaseError(str(e).strip())


class PgConnection:
    """psycopg connection with sqlite3's calling conventions (see the module docstring)."""

    def __init__(self, url: str, schema: str = "public"):
        self._url, self.schema = url, schema
        self._in_txn = False
        self._open()

    def _open(self):
        import psycopg
        self._pg = psycopg.connect(self._url, autocommit=True)
        self._pg.adapters.register_loader("numeric", _numeric_loader())  # SUM(bigint) etc.: int/float like SQLite, not Decimal
        if self.schema != "public":
            self._pg.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"')
        self._pg.execute(f'SET search_path TO "{self.schema}", public')  # public: extensions such as pgvector's `vector` type

    def _dropped(self) -> bool:
        return self._pg.closed or self._pg.broken

    def _ensure_open(self):
        """The server closed the connection (restart, idle timeout, network): open a new one before the next call.
        Never inside a transaction: its uncommitted work is gone, and the caller must hear about that."""
        if not self._in_txn and self._dropped():
            log.warning("database connection was closed; reconnecting")
            self._open()

    # --- statements ------------------------------------------------------------------------------------------
    def execute(self, sql: str, params=()):
        if m := _PRAGMA.match(sql):
            return self._table_info(m.group(1))
        # without parameters psycopg sends the SQL as-is (no `%` handling), so only translate when there are some
        return self._run(lambda cur: cur.execute(translate(sql), _params(params)) if params else cur.execute(sql), sql)

    def executemany(self, sql: str, seq):
        return self._run(lambda cur: cur.executemany(translate(sql), [_params(p) for p in seq]), sql)

    def executescript(self, script: str):
        self.commit()  # sqlite3's executescript commits first, then runs the script outside a transaction
        self._ensure_open()
        try:
            self._pg.execute(ddl(script))
        except Exception as e:
            raise _as_sqlite_error(e) from e

    def _run(self, fn, sql):
        import psycopg
        for attempt in (1, 2):
            self._ensure_open()
            began = DML.match(sql) and not self._in_txn
            try:
                if began:
                    self._pg.execute("BEGIN")
                    self._in_txn = True
                cur = self._pg.cursor()
                fn(cur)
                return _Cursor(cur)
            except psycopg.Error as e:
                dropped = self._dropped()
                lost_work = self._in_txn and not began  # earlier statements of this transaction were uncommitted
                if self._in_txn:
                    # Postgres aborts the whole transaction on an error; end it so the connection stays usable
                    # ponytail: sqlite3 would keep the transaction open; add per-statement SAVEPOINTs if a caller needs that
                    self._in_txn = False
                    if not dropped:
                        self._pg.execute("ROLLBACK")
                if dropped and attempt == 1 and not lost_work:
                    continue  # nothing of the caller's was lost: reconnect and run this statement once more
                raise _as_sqlite_error(e) from e

    def _table_info(self, table: str):
        self._ensure_open()
        cur = self._pg.cursor()
        cur.execute("""SELECT c.ordinal_position - 1, c.column_name, upper(c.data_type), (c.is_nullable = 'NO')::int,
                              c.column_default,
                              (EXISTS (SELECT 1 FROM information_schema.key_column_usage k
                                       JOIN information_schema.table_constraints t USING (constraint_schema, constraint_name)
                                       WHERE t.constraint_type = 'PRIMARY KEY' AND k.table_schema = c.table_schema
                                         AND k.table_name = c.table_name AND k.column_name = c.column_name))::int
                       FROM information_schema.columns c
                       WHERE c.table_schema = current_schema() AND c.table_name = %s ORDER BY c.ordinal_position""", (table,))
        return _Cursor(cur)

    # --- transactions ----------------------------------------------------------------------------------------
    def commit(self):
        if self._in_txn:
            self._in_txn = False
            try:
                self._pg.execute("COMMIT")
            except Exception as e:  # a dropped connection here: the outcome is unknown, so never retry a COMMIT
                raise _as_sqlite_error(e) from e

    def rollback(self):
        if self._in_txn:
            self._in_txn = False
            if not self._dropped():
                self._pg.execute("ROLLBACK")

    @property
    def in_transaction(self) -> bool:
        return self._in_txn

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.rollback() if exc_type else self.commit()
        return False

    def close(self):
        self.rollback()
        self._pg.close()


@lru_cache
def _numeric_loader():  # built on first use: psycopg is only needed when Postgres is
    from psycopg.adapt import Loader

    class NumericLoader(Loader):
        def load(self, data):
            s = bytes(data).decode()
            return float(s) if any(c in s for c in ".eEN") else int(s)  # "N": NaN
    return NumericLoader


class _Cursor:
    """psycopg cursor; iterating it yields rows, like sqlite3."""

    def __init__(self, cur):
        self._cur = cur

    def __iter__(self):
        return iter(self._cur.fetchall() if self._cur.description else [])

    def fetchone(self):
        return self._cur.fetchone() if self._cur.description else None

    def fetchall(self):
        return self._cur.fetchall() if self._cur.description else []

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    @property
    def lastrowid(self):  # not available on Postgres; use INSERT ... RETURNING id
        return None
