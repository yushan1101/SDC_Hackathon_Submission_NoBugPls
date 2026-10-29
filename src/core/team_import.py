"""Team CSV -> validated per-employee Requests (shared by Streamlit and the web API). Rejects, never guesses."""
import re

import pandas as pd
from pydantic import ValidationError

from core.state import Profile, Request, Skill

COLUMNS = ["employee_id", "target_role", "weekly_hours", "skill", "level"]
EMP_ID = re.compile(r"^[A-Za-z0-9_-]{1,32}$")  # pseudonymous IDs only: no names / emails
# Other HR systems export the same facts under other names; each header maps to one column, nothing is inferred.
ALIASES = {
    "employee_id": ["employee_id", "employee", "emp_id", "staff_id", "id", "person_id", "candidate_id", "member_id", "student_id"],
    "target_role": ["target_role", "role", "job", "job_title", "title", "position", "occupation", "target_job"],
    "weekly_hours": ["weekly_hours", "hours", "hours_per_week", "learning_hours", "weekly_learning_hours"],
    "skill": ["skill", "skill_name", "competency", "competence"],
    "level": ["level", "skill_level", "proficiency", "score", "rating"],
    "department": ["department", "dept", "team", "unit", "division", "faculty"],
    "group": ["group", "cohort", "site", "location", "company", "organisation", "organization", "class", "batch"],
}
LEVEL_SCALES = {5: 1, 10: 0.5, 100: 0.05}  # the file's top level -> multiplier onto the 0-5 scale (HR says which)
DEFAULT_HOURS = 4


def normalize_team(df: pd.DataFrame, level_max: int = 5) -> tuple[pd.DataFrame, dict, list[str]]:
    """Any reasonable HR export -> the long COLUMNS layout, plus {employee_id: {department, group}} and notes on what
    was read. Long files have skill/level columns; wide files (one row per person) have one column per skill."""
    if level_max not in LEVEL_SCALES:
        return df, {}, [f"level scale must be one of {sorted(LEVEL_SCALES)}"]
    key = lambda c: re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")
    df = df.rename(columns={c: key(c) for c in df.columns})
    found = {}
    for col, names in ALIASES.items():
        hit = next((n for n in names if n in df.columns), None)
        if hit:
            found[col] = hit
    df = df.rename(columns={v: k for k, v in found.items()})
    notes = [f"read '{v}' as {k}" for k, v in found.items() if k != v]
    if "weekly_hours" not in df.columns:
        df["weekly_hours"] = DEFAULT_HOURS
        notes.append(f"no weekly hours column: {DEFAULT_HOURS} h/week assumed for everyone")
    if "skill" not in df.columns and "level" not in df.columns and {"employee_id", "target_role"} <= set(df.columns):
        skill_cols = [c for c in df.columns if c not in ALIASES]
        if not skill_cols:
            return df, {}, ["no skill columns found: add skill and level columns, or one column per skill"]
        df = df.melt(id_vars=[c for c in df.columns if c not in skill_cols], value_vars=skill_cols, var_name="skill", value_name="level")
        df = df[df["level"].notna() & (df["level"].astype(str).str.strip() != "")]
        df["skill"] = df["skill"].str.replace("_", " ")
        notes.append(f"one row per person: {len(skill_cols)} skill columns read as skills")
    if "level" in df.columns and level_max != 5:
        df["level"] = (pd.to_numeric(df["level"], errors="coerce") * LEVEL_SCALES[level_max]).round()
        notes.append(f"levels converted from 0-{level_max} to 0-5")
    meta = {}
    if "employee_id" in df.columns:
        for eid, g in df.groupby(df["employee_id"].astype(str).str.strip()):
            meta[eid] = {k: str(g[k].dropna().iloc[0]).strip()[:80] for k in ("department", "group") if k in g and g[k].notna().any()}
    return df, meta, notes


def parse_team(df: pd.DataFrame, resolve, scenario: str, max_rows: int, max_team: int) -> tuple[list[Request], list[str]]:
    """resolve(target_role) -> ESCO occupation code or None (any official/alternate title or code is accepted)."""
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
        errs.append(f"unknown target_role (not an ESCO occupation title or code): {bad_roles[:5]}")
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
