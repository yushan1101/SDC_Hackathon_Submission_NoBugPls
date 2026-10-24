"""One-time, development-only migration from the app SQLite file to Replit PostgreSQL.

Run from src with DATABASE_URL available:
    uv run python scripts/migrate_replit_sqlite_to_postgres.py --confirm-development

The SQLite source is never modified. The script refuses to run if the target
PostgreSQL public schema already contains application tables.
"""
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

import psycopg
from psycopg import sql

SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))


def _sqlite_snapshot(source: Path) -> Path:
    if not source.exists():
        raise FileNotFoundError(f"SQLite database not found: {source}")
    fd, name = tempfile.mkstemp(prefix="aiversepulse-migration-", suffix=".sqlite3", dir=source.parent)
    os.close(fd)
    snapshot = Path(name)
    with sqlite3.connect(source) as old, sqlite3.connect(snapshot) as new:
        old.backup(new)
    return snapshot


def _initialize_latest_sqlite_schema(snapshot: Path) -> None:
    """Run the existing SQLite initializers against the snapshot to add current tables/columns."""
    os.environ["DATABASE_BACKEND"] = "sqlite"
    os.environ["DATABASE_PATH"] = str(snapshot)
    os.environ["WARM_ON_START"] = "false"
    os.environ["SIGNALS_DAILY"] = "false"
    import server.api as api  # noqa: PLC0415 - config must be set before the application import

    api.db.close()


def _ordered_tables(con: sqlite3.Connection) -> list[str]:
    tables = [row[0] for row in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    dependencies = {
        table: {row[2] for row in con.execute(f'PRAGMA foreign_key_list("{table}")')}
        for table in tables
    }
    ordered: list[str] = []
    remaining = set(tables)
    while remaining:
        ready = sorted(table for table in remaining if not (dependencies[table] & remaining))
        if not ready:
            raise RuntimeError(f"Foreign-key cycle prevents safe migration: {sorted(remaining)}")
        ordered.extend(ready)
        remaining.difference_update(ready)
    return ordered


def _postgres_table_ddl(statement: str) -> str:
    statement = re.sub(
        r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b",
        "BIGSERIAL PRIMARY KEY",
        statement,
        flags=re.I,
    )
    statement = re.sub(r"\bINTEGER\s+PRIMARY\s+KEY\b", "SERIAL PRIMARY KEY", statement, flags=re.I)
    statement = re.sub(r"\bBLOB\b", "BYTEA", statement, flags=re.I)
    statement = re.sub(r"\bwindow\b", '"window"', statement, flags=re.I)
    return statement


def _create_tables(pg, sqlite_con: sqlite3.Connection, tables: list[str]) -> None:
    for table in tables:
        row = sqlite_con.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not row or not row[0]:
            continue
        pg.execute(_postgres_table_ddl(row[0]))

    indexes = sqlite_con.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
    ).fetchall()
    for (statement,) in indexes:
        pg.execute(statement)


def _copy_rows(pg, sqlite_con: sqlite3.Connection, tables: list[str]) -> tuple[int, int]:
    table_count = 0
    row_count = 0
    for table in tables:
        columns = [row[1] for row in sqlite_con.execute(f'PRAGMA table_info("{table}")')]
        rows = sqlite_con.execute(f'SELECT * FROM "{table}"').fetchall()
        if not columns or not rows:
            table_count += 1
            continue
        query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier(table),
            sql.SQL(", ").join(sql.Identifier(column) for column in columns),
            sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        )
        pg.executemany(query, rows)
        table_count += 1
        row_count += len(rows)
    return table_count, row_count


def _reset_sequences(pg, sqlite_con: sqlite3.Connection, tables: list[str]) -> None:
    for table in tables:
        info = sqlite_con.execute(f'PRAGMA table_info("{table}")').fetchall()
        pk_columns = [row for row in info if row[5]]
        if len(pk_columns) != 1 or "INT" not in pk_columns[0][2].upper():
            continue
        column = pk_columns[0][1]
        sequence = pg.execute("SELECT pg_get_serial_sequence(%s, %s)", (table, column)).fetchone()[0]
        if not sequence:
            continue
        maximum = pg.execute(
            sql.SQL("SELECT MAX({}) FROM {}").format(sql.Identifier(column), sql.Identifier(table))
        ).fetchone()[0]
        if maximum is not None:
            pg.execute("SELECT setval(%s::regclass, %s, true)", (sequence, maximum))


def _create_immutability_triggers(pg) -> None:
    statements = [
        """CREATE FUNCTION prevent_review_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'hr_review_events are immutable'; END $$""",
        """CREATE TRIGGER hr_review_events_immutable BEFORE UPDATE ON hr_review_events
           FOR EACH ROW EXECUTE FUNCTION prevent_review_event_update()""",
        """CREATE FUNCTION prevent_review_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'hr_review_events must be retained'; END $$""",
        """CREATE TRIGGER hr_review_events_retained BEFORE DELETE ON hr_review_events
           FOR EACH ROW EXECUTE FUNCTION prevent_review_event_delete()""",
        """CREATE FUNCTION prevent_plan_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'plan_versions are immutable'; END $$""",
        """CREATE TRIGGER versions_immutable BEFORE UPDATE ON plan_versions
           FOR EACH ROW EXECUTE FUNCTION prevent_plan_version_update()""",
    ]
    for statement in statements:
        pg.execute(statement)


def migrate(source: Path, database_url: str) -> tuple[int, int]:
    snapshot = _sqlite_snapshot(source)
    try:
        _initialize_latest_sqlite_schema(snapshot)
        with sqlite3.connect(snapshot) as sqlite_con:
            tables = _ordered_tables(sqlite_con)
            with psycopg.connect(database_url, connect_timeout=10) as pg:
                existing = pg.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_type='BASE TABLE' LIMIT 1"
                ).fetchone()
                if existing:
                    raise RuntimeError(
                        "The development PostgreSQL database is not empty; migration stopped without writing."
                    )
                _create_tables(pg, sqlite_con, tables)
                counts = _copy_rows(pg, sqlite_con, tables)
                _reset_sequences(pg, sqlite_con, tables)
                _create_immutability_triggers(pg)
                return counts
    finally:
        snapshot.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-development", action="store_true")
    args = parser.parse_args()
    if not args.confirm_development:
        parser.error("Pass --confirm-development to confirm the target is the development database.")
    if os.environ.get("REPLIT_ENVIRONMENT", "").lower() == "production":
        raise SystemExit("Refusing to run the SQLite migration in a production environment.")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("Replit-managed DATABASE_URL is unavailable.")
    source = Path(os.environ.get("DATABASE_PATH", SRC / "data" / "audit.sqlite3"))
    tables, rows = migrate(source, database_url)
    print(f"Migrated {rows} records across {tables} application tables into the development database.")
    print("The source SQLite database was left unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
