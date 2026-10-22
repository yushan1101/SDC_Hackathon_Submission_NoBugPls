"""Reserve persistent employee IDs for new HR analyses."""
import re


def allocate_ids(con, original_ids: list[str], account_ids: list[str]) -> list[str]:
    # The caller holds the shared database lock. Keep reservations even if a run
    # fails or its plans are deleted, so later runs never reuse these IDs.
    existing = original_ids + account_ids + [r[0] for r in con.execute("SELECT subject_id FROM plans")]
    numbers = [int(m.group(1)) for value in existing if (m := re.fullmatch(r"E-(\d+)", value or ""))]
    last = con.execute("SELECT max(number) FROM analysis_employee_ids").fetchone()[0] or 0
    start = max([last, *numbers]) + 1
    reserved = list(range(start, start + len(original_ids)))
    with con:
        con.executemany("INSERT INTO analysis_employee_ids(number) VALUES(?)", [(n,) for n in reserved])
    return [f"E-{n:03d}" for n in reserved]
