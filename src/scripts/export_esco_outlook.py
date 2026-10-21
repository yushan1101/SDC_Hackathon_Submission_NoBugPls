"""Offline: carry the STF-KAN skill outlook (trained on the O*NET release history) over to ESCO.

    python scripts/export_esco_outlook.py     # after build_esco_requirements.py

Reads the training-side files (onet_outlook.json = model output on O*NET keys, onet_occupations.json) and writes
data/snapshots/esco_outlook.json keyed by ESCO occupation code and ESCO skill label, which is all the live
`skill_outlook` MCP tool reads, plus data/snapshots/esco_onet_map.json, which the tool uses to run the model live on
CPU (forecasting/serving.py) and falls back to esco_outlook.json only when the model artifacts are not installed.
Mapping: each ESCO occupation -> its closest training occupation (MiniLM on title + description); each ESCO skill ->
the closest forecast item of that occupation (cosine >= 0.6), whatever its direction. Only validated "rising" flags
are stored in esco_outlook.json; the live path returns every mapped skill.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

SNAP, TRAIN = Path("data/snapshots"), Path("data/training_snapshots")
SKILL_SIM, OCC_SIM = 0.60, 0.55


def embed(texts):
    from mcp_server.retrieval import _embed
    out = []
    for i in range(0, len(texts), 512):
        out += _embed(texts[i:i + 512])
    return np.asarray(out, np.float32)


def main():
    src = json.loads((TRAIN / "onet_outlook.json").read_text(encoding="utf-8"))
    train_occ = json.loads((TRAIN / "onet_occupations.json").read_text(encoding="utf-8"))["occupations"]
    esco = json.loads((SNAP / "esco_occupations.json").read_text(encoding="utf-8"))["occupations"]
    tsocs = [s for s in src["occupations"] if s in train_occ]
    T = embed([f"{train_occ[s]['title']}. {train_occ[s]['description']}" for s in tsocs])
    codes = list(esco)
    E = embed([f"{esco[c]['title']}. {esco[c]['description']}" for c in codes])
    best = (E @ T.T)
    tskills = sorted({k for s in tsocs for k in src["occupations"][s]})
    TS = dict(zip(tskills, embed(tskills)))
    labels = sorted({k for c in codes for k in esco[c]["skills"]})
    LS = dict(zip(labels, embed(labels)))
    out, mapping, rising = {}, {}, 0
    for i, c in enumerate(codes):
        j = int(best[i].argmax())
        if best[i, j] < OCC_SIM:
            continue
        soc, f = tsocs[j], src["occupations"][tsocs[j]]
        items = list(f)
        U = np.stack([TS[k] for k in items])
        occ_map, occ_out = {}, {}
        for name in esco[c]["skills"]:
            s = U @ LS[name]
            k = int(s.argmax())
            if s[k] < SKILL_SIM:
                continue
            v = f[items[k]]
            sim = round(float(s[k] * best[i, j]), 3)
            occ_map[name] = [items[k], "skill" if v["unit"].startswith("O*NET importance") else "tool", sim]
            if v["direction"] == "rising":
                occ_out[name] = {"current": v["current"], "forecast": v["forecast"], "band": v.get("band"),
                                 "direction": "rising", "unit": "forecast importance rank (transferred)",
                                 "via_similarity": sim}
                rising += 1
        mapping[c] = {"soc": soc, "occ_similarity": round(float(best[i, j]), 3), "skills": occ_map}
        out[c] = occ_out
    model = src["model"] | {"transfer": "ESCO occupation/skill <- closest training occupation/skill (MiniLM)",
                            "direction_counts": {"rising": rising}}
    (SNAP / "esco_outlook.json").write_text(json.dumps({"model": model, "occupations": out}), encoding="utf-8")
    (SNAP / "esco_onet_map.json").write_text(json.dumps(mapping, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} ESCO occupations, {rising} rising skill flags -> esco_outlook.json (+ esco_onet_map.json)")


if __name__ == "__main__":
    main()
