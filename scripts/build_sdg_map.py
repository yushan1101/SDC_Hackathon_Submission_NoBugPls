"""Map every O*NET occupation and skill to the 17 UN SDGs (official goal + target text) -> data/snapshots/sdg_map.json

    python scripts/build_sdg_map.py
Method: MiniLM cosine similarity between each occupation (title, description, core tasks) / skill (O*NET
definition) and all 169 official SDG targets (UN Statistics Division SDG API). A goal's score is its best target;
we keep the top goals with the matched target as evidence. This is a transparent semantic mapping, NOT an
official UN classification; the UI says so.
"""
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents.knowledge import snapshot  # noqa: E402
from mcp_server.retrieval import _embed  # noqa: E402

OUT = Path("data/snapshots/sdg_map.json")
SDG_API = "https://unstats.un.org/SDGAPI/v1/sdg/Goal/List?includechildren=true"
COLORS = ["#E5243B", "#DDA63A", "#4C9F38", "#C5192D", "#FF3A21", "#26BDE2", "#FCC30B", "#A21942", "#FD6925",
          "#DD1367", "#FD9D24", "#BF8B2E", "#3F7E44", "#0A97D9", "#56C02B", "#00689D", "#19486A"]
SHORT = ["No poverty", "Zero hunger", "Good health and well-being", "Quality education", "Gender equality",
         "Clean water and sanitation", "Affordable and clean energy", "Decent work and economic growth",
         "Industry, innovation and infrastructure", "Reduced inequalities", "Sustainable cities and communities",
         "Responsible consumption and production", "Climate action", "Life below water", "Life on land",
         "Peace, justice and strong institutions", "Partnerships for the goals"]


def main():
    with urllib.request.urlopen(urllib.request.Request(SDG_API, headers={"User-Agent": "AiversePulse"}), timeout=90) as r:
        goals = json.load(r)
    targets = [(int(g["code"]), t["code"], t["title"]) for g in goals for t in g["targets"]]
    T = np.asarray(_embed([f"{SHORT[g - 1]}: {title}" for g, _, title in targets]))
    gid = np.array([g for g, _, _ in targets])

    def top_goals(vecs, k):
        S = np.asarray(vecs) @ T.T  # (n, 169)
        out = []
        for row in S:
            best = {}
            for j, s in enumerate(row):
                g = int(gid[j])
                if g not in best or s > best[g][0]:
                    best[g] = (float(s), j)
            ranked = sorted(best.items(), key=lambda kv: -kv[1][0])
            mu, sd = np.mean([v[0] for v in best.values()]), np.std([v[0] for v in best.values()]) + 1e-9
            out.append([{"goal": g, "score": round(s, 3), "z": round((s - mu) / sd, 2), "target": targets[j][1],
                         "target_text": targets[j][2]} for g, (s, j) in ranked[:k]])
        return out

    occ = snapshot()["occupations"]
    socs = list(occ)
    occ_vec = _embed([f"{o['title']}. {o['description']} {' '.join(o['tasks'][:4])}" for o in occ.values()])
    z = zipfile.ZipFile("data/raw/onet/db_31_0_text.zip")
    cm = [l.split("\t") for l in z.read("db_31_0_text/Content Model Reference.txt").decode("utf-8", "replace").splitlines()[1:]]
    names = sorted({s for o in occ.values() for s in o["skills"]})
    defs = {n: next((c[2] for c in cm if len(c) > 2 and c[1] == n), n) for n in names}
    sk_vec = _embed([f"{n}: {defs[n]}" for n in names])
    out = {"source": "UN Statistics Division SDG API (goals + 169 targets); O*NET 31.0 (CC BY 4.0)",
           "method": "MiniLM similarity to official SDG targets; semantic mapping, not an official UN classification",
           "goals": [{"goal": i + 1, "short": SHORT[i], "title": g["title"], "color": COLORS[i],
                      "url": f"https://sdgs.un.org/goals/goal{i + 1}"} for i, g in enumerate(goals)],
           "occupations": dict(zip(socs, top_goals(occ_vec, 3))),
           "skills": {n: {"definition": defs[n], "sdgs": g} for n, g in zip(names, top_goals(sk_vec, 2))}}
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    cover = sorted({x["goal"] for v in out["occupations"].values() for x in v})
    print(f"{len(socs)} occupations, {len(names)} skills -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB); goals used: {cover}")


if __name__ == "__main__":
    main()
