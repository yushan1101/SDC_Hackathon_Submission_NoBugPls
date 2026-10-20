"""O*NET release history 25.0 (Aug 2020) .. 31.0 (Aug 2026) -> training series for STF-KAN (TRAINING ONLY).

    python scripts/build_onet_history.py            # downloads zips into data/raw/onet_history/ (cached)
Writes data/training/onet_history.csv (gitignored, reproducible): one row per (soc, item, kind) with one
column per release. kind=skill: O*NET importance IM (1-5); kind=tool: Hot Technology flag (0/1).
All releases use the O*NET-SOC 2019 taxonomy, so codes line up across the series.
"""
import csv
import io
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

RELEASES = [f"{M}.{m}" for M in range(25, 31) for m in range(4)] + ["31.0"]
RAW = Path("data/raw/onet_history")
OUT = Path("data/training/onet_history.csv")


def fetch(rel: str) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    p = RAW / f"db_{rel.replace('.', '_')}_text.zip"
    if not p.exists():
        url = f"https://www.onetcenter.org/dl_files/database/{p.name}"
        print("downloading", url, flush=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "AiversePulse"}), timeout=120) as r:
            p.write_bytes(r.read())
    return p


def table(z: zipfile.ZipFile, *names):
    for n in names:
        hit = [x for x in z.namelist() if x.endswith(f"/{n}.txt")]
        if hit:
            return list(csv.DictReader(io.StringIO(z.read(hit[0]).decode("utf-8", "replace")), delimiter="\t"))
    return []


def parse(rel: str):
    z = zipfile.ZipFile(fetch(rel))
    skills = {}
    for r in table(z, "Skills") + table(z, "Essential Skills") + table(z, "Transferable Skills"):
        if r.get("Scale ID") == "IM" and r.get("Recommend Suppress", "N") != "Y":
            skills[(r["O*NET-SOC Code"], r["Element Name"])] = float(r["Data Value"])
    tools = {}
    for r in table(z, "Technology Skills") + table(z, "Software Skills"):
        name = r.get("Example") or r.get("Workplace Example")
        if name:
            tools[(r["O*NET-SOC Code"], name)] = 1.0 if r.get("Hot Technology") == "Y" else 0.0
    return skills, tools


def main():
    rels = [r for r in RELEASES if not sys.argv[1:] or r in sys.argv[1:]]
    series = {}  # (soc, item, kind) -> {rel: value}
    for rel in rels:
        skills, tools = parse(rel)
        for (soc, item), v in skills.items():
            series.setdefault((soc, item, "skill"), {})[rel] = v
        for (soc, item), v in tools.items():
            series.setdefault((soc, item, "tool"), {})[rel] = v
        print(f"{rel}: {len(skills)} skill ratings, {len(tools)} tool rows", flush=True)
    # keep tools that were Hot at least once (the rest carry no signal), and items seen in >= 6 releases
    keep = {k: v for k, v in series.items() if len(v) >= 6 and (k[2] == "skill" or max(v.values()) > 0)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["soc", "item", "kind"] + rels)
        for (soc, item, kind), v in sorted(keep.items()):
            w.writerow([soc, re.sub(r"\s+", " ", item), kind] + [v.get(r, "") for r in rels])
    print(f"{len(keep)} series x {len(rels)} releases -> {OUT}")


if __name__ == "__main__":
    main()
