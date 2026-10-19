"""Job ads (Ashy24/data_jobs, 2023) -> weekly skill-mention series + role skill profile.

mention_percent(r,s,w) = 100 * ads in (r,w) listing s / ads in (r,w) with a parseable skill list.
eligible_posts == 0 (or below --min-posts) is *missing*, never 0% demand.

Usage:
    python scripts/prepare_jobs.py --input data/raw/data_jobs.csv
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

import pandas as pd

SOURCE_ID = "hf:Ashy24/data_jobs"
SOURCE_URL = "https://huggingface.co/datasets/Ashy24/data_jobs"


def parse_skills(raw) -> list[str]:
    if not isinstance(raw, str) or not raw.startswith("["):
        return []
    try:  # literal_eval only parses literals, never executes code
        return sorted({str(s).strip().lower() for s in ast.literal_eval(raw) if str(s).strip()})
    except (ValueError, SyntaxError):
        return []


def _weekly(df: pd.DataFrame, keep, weeks, geography: str, min_posts: int) -> pd.DataFrame:
    eligible = df.groupby(["role_id", "week_start"]).size().rename("eligible_posts")
    long = df[["role_id", "week_start", "skills"]].explode("skills").rename(columns={"skills": "skill_id"})
    counts = long[long["skill_id"].isin(keep)].groupby(["role_id", "week_start", "skill_id"]).size()
    # full grid so missing weeks are explicit rows, not silently dropped
    grid = pd.MultiIndex.from_product([sorted(df["role_id"].unique()), weeks, sorted(keep)],
                                      names=["role_id", "week_start", "skill_id"])
    out = counts.reindex(grid, fill_value=0).rename("skill_posts").reset_index()
    out = out.merge(eligible.reset_index(), on=["role_id", "week_start"], how="left")
    out["eligible_posts"] = out["eligible_posts"].fillna(0).astype(int)
    out["mention_percent"] = (100 * out["skill_posts"] / out["eligible_posts"]).where(out["eligible_posts"] >= min_posts)
    out["geography"] = geography
    return out


def build(df: pd.DataFrame, top_skills: int = 30, min_posts: int = 30, min_country_avg: float = 30):
    df = df.drop_duplicates(["job_title", "company_name", "job_location", "job_posted_date"])
    df = df.assign(skills=df["job_skills"].map(parse_skills))
    df = df[df["skills"].map(bool)]  # eligible = parseable, non-empty skill list
    posted = pd.to_datetime(df["job_posted_date"])
    df = df.assign(role_id=df["job_title_short"].str.strip(),
                   week_start=(posted - pd.to_timedelta(posted.dt.weekday, unit="D")).dt.normalize())
    weeks = pd.date_range(df["week_start"].min(), df["week_start"].max(), freq="7D")
    long = df[["role_id", "skills"]].explode("skills")
    keep = long["skills"].value_counts().head(top_skills).index

    parts = [_weekly(df, keep, weeks, "global", min_posts)]
    # country series: only role-country pairs averaging >= min_country_avg eligible ads/week
    avg = df.groupby(["job_country", "role_id"]).size() / len(weeks)
    for country, roles in avg[avg >= min_country_avg].reset_index().groupby("job_country")["role_id"]:
        sub = df[(df["job_country"] == country) & df["role_id"].isin(set(roles))]
        parts.append(_weekly(sub, keep, weeks, country, min_posts))
    out = pd.concat(parts, ignore_index=True)
    out["data_source"] = SOURCE_ID
    out["source_window_start"] = str(posted.min().date())
    out["source_window_end"] = str(posted.max().date())
    out["week_start"] = out["week_start"].dt.date.astype(str)

    # whole-year global role profile: used by the deterministic gap analyst as dated evidence
    role_totals = df.groupby("role_id").size()
    role_skill = df[["role_id", "skills"]].explode("skills").groupby(["role_id", "skills"]).size()
    profile = {
        "source_id": SOURCE_ID, "source_url": SOURCE_URL,
        "window": [str(posted.min().date()), str(posted.max().date())],
        "roles": {r: {"eligible_posts": int(n),
                      "skills": {s: round(100 * c / n, 1)
                                 for s, c in role_skill[r].sort_values(ascending=False).head(15).items()}}
                  for r, n in role_totals.items()},
    }
    return out, profile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="data/raw/data_jobs.csv")
    ap.add_argument("--out-dir", default="data/snapshots")
    ap.add_argument("--top-skills", type=int, default=30)
    ap.add_argument("--min-posts", type=int, default=30)
    a = ap.parse_args()
    cols = ["job_title_short", "job_title", "job_location", "job_posted_date", "company_name", "job_skills", "job_country"]
    raw = pd.read_csv(a.input, usecols=cols)
    weekly, profile = build(raw, a.top_skills, a.min_posts)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    weekly.to_csv(out / "weekly_skill_demand.csv", index=False)
    profile["input_sha256"] = hashlib.sha256(Path(a.input).read_bytes()).hexdigest()
    (out / "role_skills.json").write_text(json.dumps(profile, indent=1))
    cov = weekly.groupby("geography")["mention_percent"].apply(lambda s: round(s.notna().mean(), 3))
    print(f"rows={len(weekly)} series={weekly.groupby(['geography', 'role_id', 'skill_id']).ngroups}")
    print("lowest weekly coverage by geography:\n" + cov.sort_values().head(8).to_string())


if __name__ == "__main__":
    main()
