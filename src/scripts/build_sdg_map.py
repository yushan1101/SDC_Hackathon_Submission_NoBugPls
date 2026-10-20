"""Map every ESCO occupation and skill to the 17 UN SDGs (official goal + target text) -> data/snapshots/sdg_map.json

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
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents.knowledge import snapshot  # noqa: E402
from mcp_server.retrieval import _embed  # noqa: E402
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

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
        G = np.full((len(S), 17), -1.0); J = np.zeros((len(S), 17), int)
        for j in range(len(targets)):  # best target per goal
            g = gid[j] - 1
            better = S[:, j] > G[:, g]
            G[better, g], J[better, g] = S[better, j], j
        mu, sd = G.mean(1, keepdims=True), G.std(1, keepdims=True) + 1e-9
        Z = (G - mu) / sd
        out = []
        for i in range(len(S)):
            order = np.argsort(-G[i])[:k]
            out.append([{"goal": int(g + 1), "score": round(float(G[i, g]), 3), "z": round(float(Z[i, g]), 2),
                         "target": targets[J[i, g]][1]} for g in order])
        return out

    occ = snapshot()["occupations"]
    socs = list(occ)
    occ_vec = _embed([f"{o['title']}. {o['description']}" for o in occ.values()])
    names = sorted({s for o in occ.values() for s in o["skills"]})
    sk_vec = np.concatenate([_embed(names[i:i + 512]) for i in range(0, len(names), 512)])
    out = {"source": "UN Statistics Division SDG API (goals + 169 targets); ESCO v1.2 (European Commission)",
           "method": "MiniLM similarity to official SDG targets; semantic mapping, not an official UN classification",
           "goals": [{"goal": i + 1, "short": SHORT[i], "title": g["title"], "color": COLORS[i],
                      "url": f"https://sdgs.un.org/goals/goal{i + 1}"} for i, g in enumerate(goals)],
           "targets": {code: title for _, code, title in targets},
           "occupations": dict(zip(socs, top_goals(occ_vec, 3))),
           "skills": {n: {"sdgs": g} for n, g in zip(names, top_goals(sk_vec, 2))}}
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    cover = sorted({x["goal"] for v in out["occupations"].values() for x in v})
    print(f"{len(socs)} occupations, {len(names)} skills -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB); goals used: {cover}")


if __name__ == "__main__":
    main()
