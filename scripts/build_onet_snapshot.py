"""O*NET 31.0 -> compact requirements snapshot for EVERY rated occupation (the live agents' source of truth).

    python scripts/build_onet_snapshot.py --onet data/raw/onet/db_31_0_text.zip
Writes data/snapshots/onet_occupations.json. O*NET 31.0 Database, CC BY 4.0, USDOL/ETA (US-oriented).

Rules (documented, deterministic):
- A skill counts for an occupation when O*NET importance (IM, 1-5) >= 3.0 and the row is not suppressed.
- Required proficiency (0-5) = round(level LV (0-7) / 7 * 5).
- Tools = O*NET software examples flagged Hot Technology or In Demand (max 8); required level 2 is an
  assumption ("working knowledge"), labelled as such in the UI.
The 2023 job-ad dataset is NOT used here: it is training data for the forecasting model only.
"""
import argparse
import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

OUT = Path("data/snapshots/onet_occupations.json")
IMPORTANT = 3.0
MAX_TECH = 8


def rows(z, name):
    return csv.DictReader(io.StringIO(z.read(f"db_31_0_text/{name}.txt").decode("utf-8")), delimiter="\t")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onet", default="data/raw/onet/db_31_0_text.zip")
    a = ap.parse_args()
    z = zipfile.ZipFile(a.onet)

    occ = {r["O*NET-SOC Code"]: r for r in rows(z, "Occupation Data")}
    ratings = defaultdict(dict)  # soc -> skill -> {element, im, lv, date, source}
    for name in ("Essential Skills", "Transferable Skills"):
        for r in rows(z, name):
            if r["Recommend Suppress"] == "Y":
                continue
            d = ratings[r["O*NET-SOC Code"]].setdefault(r["Element Name"], {"element": r["Element ID"]})
            d[r["Scale ID"].lower()] = float(r["Data Value"])
            d["date"], d["source"] = r["Date"], r["Domain Source"]
    tech = defaultdict(list)
    for r in rows(z, "Software Skills"):
        if r["Hot Technology"] == "Y" or r["In Demand"] == "Y":
            tech[r["O*NET-SOC Code"]].append([r["Workplace Example"], r["Hot Technology"] == "Y", r["In Demand"] == "Y"])
    tasks = defaultdict(list)
    for r in rows(z, "Task Statements"):
        if r["Task Type"] == "Core":
            tasks[r["O*NET-SOC Code"]].append(r["Task"])
    zone = {r["O*NET-SOC Code"]: int(r["Job Zone"]) for r in rows(z, "Job Zones")}

    occupations = {}
    for soc, sk in ratings.items():
        skills = {name: {"element": d["element"], "importance": round(d["im"], 2), "level_7": round(d["lv"], 2),
                         "required": round(d["lv"] / 7 * 5), "date": d["date"], "source": d["source"]}
                  for name, d in sk.items() if d.get("im", 0) >= IMPORTANT and "lv" in d}
        if not skills or soc not in occ:
            continue
        t = sorted(tech.get(soc, []), key=lambda x: (not x[2], not x[1], x[0]))[:MAX_TECH]
        occupations[soc] = {"title": occ[soc]["Title"], "description": occ[soc]["Description"], "job_zone": zone.get(soc),
                            "skills": dict(sorted(skills.items(), key=lambda kv: -kv[1]["importance"])),
                            "tech": [{"name": n, "hot": h, "in_demand": d} for n, h, d in t], "tasks": tasks.get(soc, [])[:6]}
    titles = sorted({(r["Job Title"], r["O*NET-SOC Code"]) for r in rows(z, "Job Titles") if r["O*NET-SOC Code"] in occupations}
                    | {(r["Reported Job Title"], r["O*NET-SOC Code"]) for r in rows(z, "Sample of Reported Titles")
                       if r["O*NET-SOC Code"] in occupations})
    OUT.write_text(json.dumps({"source": "O*NET 31.0 Database (Aug 2026), CC BY 4.0, USDOL/ETA",
                               "url": "https://www.onetcenter.org/database.html",
                               "rules": {"important_if_importance_gte": IMPORTANT, "required": "round(LV/7*5)",
                                         "tech_required_assumption": 2},
                               "occupations": occupations, "titles": titles}, separators=(",", ":")), encoding="utf-8")
    n_sk = sum(len(o["skills"]) for o in occupations.values())
    print(f"{len(occupations)} occupations · {n_sk} skill requirements · {len(titles)} search titles -> {OUT} "
          f"({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
