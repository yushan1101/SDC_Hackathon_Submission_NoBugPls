"""Team CSV -> validated per-employee Requests (shared by Streamlit and the web API). Rejects, never guesses."""
import re

import pandas as pd
from pydantic import ValidationError

from core.state import Profile, Request, Skill

COLUMNS = ["employee_id", "target_role", "weekly_hours", "skill", "level"]
EMP_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")  # pseudonymous IDs only: no names / emails


def parse_team(df: pd.DataFrame, resolve, scenario: str, max_rows: int, max_team: int) -> tuple[list[Request], list[str]]:
    """resolve(target_role) -> O*NET SOC code or None (any official/alternate title or code is accepted)."""
    """-> (requests, errors). Rejects the whole file on any error; never guesses."""
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        return [], [f"missing columns: {missing}"]
    if len(df) > max_rows:
        return [], [f"too many rows ({len(df)} > {max_rows})"]
    errs = []
    df = df[COLUMNS].copy()
    df["employee_id"] = df["employee_id"].astype(str).str.strip()
    bad_ids = sorted({e for e in df["employee_id"] if not EMP_ID.match(e)})
    if bad_ids:
        errs.append(f"employee_id must be pseudonymous [A-Za-z0-9_-]{{1,32}}: {bad_ids[:5]}")
    df["target_role"] = df["target_role"].astype(str).str.strip()
    socs = {r: resolve(r) for r in set(df["target_role"])}
    bad_roles = sorted(r for r, s in socs.items() if not s)
    if bad_roles:
        errs.append(f"unknown target_role (not an O*NET occupation title or code): {bad_roles[:5]}")
    reqs = []
    groups = list(df.groupby("employee_id"))
    if len(groups) > max_team:
        errs.append(f"team too large ({len(groups)} > {max_team})")
    for eid, g in groups:
        if g["target_role"].nunique() != 1 or g["weekly_hours"].nunique() != 1:
            errs.append(f"{eid}: target_role and weekly_hours must be the same on every row")
            continue
        try:
            reqs.append(Request(request_id=eid, employee_id=eid, audience="hr", scenario=scenario,
                                target_role=socs.get(str(g["target_role"].iloc[0])) or str(g["target_role"].iloc[0]),
                                query="Analyze skill gaps and create a 30-60-90 plan",
                                profile=Profile(weekly_learning_hours=float(g["weekly_hours"].iloc[0]),
                                                skills=[Skill(name=str(r.skill)[:60], level=int(r.level)) for r in g.itertuples()])))
        except (ValidationError, ValueError, TypeError) as e:
            errs.append(f"{eid}: {str(e).splitlines()[0]}")
    return ([] if errs else reqs), errs
