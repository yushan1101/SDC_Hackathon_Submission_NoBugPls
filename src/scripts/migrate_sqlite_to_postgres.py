"""Copy the app's SQLite database into Postgres and prove the copy is exact.

    DATABASE_URL=postgresql://postgres:...@host/db python scripts/migrate_sqlite_to_postgres.py SNAPSHOT.sqlite3 [--verify-only]

1. Schema: imports the app (server.api) with DATABASE_URL set, so Postgres gets exactly the tables the app creates,
   then the modules that create theirs lazily (plugins, trend signals).
2. Copy: every table in ONE transaction (all or nothing), triggers and foreign-key checks off while copying
   (session_replication_role = replica: needs a superuser), then identity sequences moved past the copied ids.
3. Verify, and exit non-zero on any difference:
   - row count per table, and a SHA-256 over each table's rows (sorted, values normalised) on both sides
   - plan_versions: every stored sha256 still matches its snapshot (the audit record is provably unchanged)
   - foreign keys: orphan rows the copy carried over (SQLite does not enforce them)
   - the same app read (approval.list_plans) for every user returns the same result on both databases
Reads SQLite read-only. Prints table names, counts and hashes only: no row contents.
"""
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

SRC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC))
os.chdir(SRC)
os.environ.setdefault("WARM_ON_START", "false")
os.environ.setdefault("SIGNALS_DAILY", "false")

SKIP = {"sqlite_sequence"}


def norm(v):
    if isinstance(v, (bytes, memoryview)):
        return "b:" + bytes(v).hex()
    if isinstance(v, float):
        return "f:" + repr(round(v, 9))
    return v


def table_hash(rows) -> str:
    return hashlib.sha256(json.dumps(sorted(json.dumps([norm(v) for v in r], default=str) for r in rows)).encode()).hexdigest()


def pg_columns(pg, table):
    return pg.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() "
                      "AND table_name = %s ORDER BY ordinal_position", (table,)).fetchall()


def coerce(v, pg_type):
    if v is None:
        return None
    if pg_type == "bigint" and not isinstance(v, int):
        return int(v)
    if pg_type == "double precision" and not isinstance(v, float):
        return float(v)
    if pg_type == "text" and not isinstance(v, str):
        return v.decode() if isinstance(v, bytes) else str(v)
    return v


def main(snapshot: str, verify_only: bool) -> int:
    import psycopg
    url = os.environ["DATABASE_URL"]
    lite = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    tables = [t for (t,) in lite.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") if t not in SKIP]
    print(f"source: {len(tables)} tables, {sum(lite.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in tables)} rows")

    if not verify_only:
        t0 = time.time()
        import server.api  # noqa: F401  creates every table the app creates at start-up, on DATABASE_URL
        from governance import plugins
        from governance.audit import connect
        from mcp_server import signals
        plugins.init(connect())
        signals.db()
        print(f"schema created in {time.time() - t0:.1f}s")

    pg = psycopg.connect(url, autocommit=True)  # so pg.transaction() below is the one real transaction
    missing = [t for t in tables if not pg_columns(pg, t)]
    if missing:
        print("FAIL: tables the app did not create on Postgres:", missing)
        return 1

    if not verify_only:
        t0 = time.time()
        coerced = 0
        with pg.transaction():
            pg.execute("SET LOCAL session_replication_role = replica")  # no triggers / FK checks while copying
            for t in tables:
                if pg.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]:
                    raise SystemExit(f"FAIL: target table {t} is not empty; migrate into a fresh database only")
                cols = pg_columns(pg, t)
                lite_cols = {r[1] for r in lite.execute(f"PRAGMA table_info({t})")}
                names = [c for c, _ in cols if c in lite_cols]
                types = dict(cols)
                rows = lite.execute(f"SELECT {', '.join(names)} FROM {t}").fetchall()
                out = []
                for r in rows:
                    c = tuple(coerce(v, types[n]) for v, n in zip(r, names))
                    coerced += sum(a is not b and a != b for a, b in zip(r, c))
                    out.append(c)
                if out:
                    with pg.cursor() as cur:
                        cur.executemany(f'INSERT INTO "{t}" ({", ".join(chr(34) + n + chr(34) for n in names)}) '
                                        f'VALUES ({", ".join(["%s"] * len(names))})', out)
            for t, col in pg.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() "
                                     "AND is_identity = 'YES'").fetchall():
                pg.execute(f"SELECT setval(pg_get_serial_sequence('\"{t}\"', '{col}'), "
                           f"GREATEST((SELECT max(\"{col}\") FROM \"{t}\"), 1), (SELECT max(\"{col}\") FROM \"{t}\") IS NOT NULL)")
        print(f"copied in {time.time() - t0:.1f}s (one transaction); values converted to the column type: {coerced}")

    ok = True
    print("\ntable                              rows sqlite -> pg   row hash")
    for t in tables:
        names = [c for c, _ in pg_columns(pg, t) if c in {r[1] for r in lite.execute(f"PRAGMA table_info({t})")}]
        a = lite.execute(f"SELECT {', '.join(names)} FROM {t}").fetchall()
        b = pg.execute(f'SELECT {", ".join(chr(34) + n + chr(34) for n in names)} FROM "{t}"').fetchall()
        same = len(a) == len(b) and table_hash(a) == table_hash(b)
        ok &= same
        print(f"{t:34} {len(a):5} -> {len(b):5}   {'same' if same else 'DIFFERENT'}  {table_hash(b)[:12]}")

    bad = [pid for pid, v, snap, sha in pg.execute("SELECT plan_id, version, snapshot, sha256 FROM plan_versions")
           if hashlib.sha256(snap.encode()).hexdigest() != sha]
    n = pg.execute("SELECT count(*) FROM plan_versions").fetchone()[0]
    print(f"\naudit: {n - len(bad)}/{n} plan versions still match their stored sha256")
    ok &= not bad

    orphans = {}
    for child, col, parent, pcol in pg.execute("""
            SELECT kcu.table_name, kcu.column_name, ccu.table_name, ccu.column_name FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
            JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()""").fetchall():
        k = pg.execute(f'SELECT count(*) FROM "{child}" c WHERE c."{col}" IS NOT NULL AND NOT EXISTS '
                       f'(SELECT 1 FROM "{parent}" p WHERE p."{pcol}" = c."{col}")').fetchone()[0]
        orphans[f"{child}.{col} -> {parent}"] = k
    print("foreign keys (orphan rows carried over from SQLite):", orphans or "none defined")

    from governance import approval
    from governance.db import PgConnection
    pgc = PgConnection(url, "public")
    users = lite.execute("SELECT username, role, employee_id FROM users").fetchall()
    diff = [u for u, r, e in users if approval.list_plans(lite, {"username": u, "role": r, "employee_id": e})
            != approval.list_plans(pgc, {"username": u, "role": r, "employee_id": e})]
    print(f"app read approval.list_plans: identical for {len(users) - len(diff)}/{len(users)} users")
    ok &= not diff
    print("\nRESULT:", "PASS: the Postgres copy matches the snapshot" if ok else "FAIL: see DIFFERENT rows above")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) < 2 or not os.environ.get("DATABASE_URL"):
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], "--verify-only" in sys.argv))
