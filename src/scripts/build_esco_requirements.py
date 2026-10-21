"""Train the requirement model on O*NET (training only) and score every ESCO occupation-skill pair.

    python scripts/build_esco_requirements.py      # needs data/raw/onet/db_31_0_text.zip + data/snapshots/esco_raw.json

O*NET is TRAINING DATA here and nowhere else: ~140k expert/incumbent ratings (importance 1-5, level 0-7) of
skills, knowledge, work activities and abilities teach a small MLP how important, and at what level, a
described capability is for a described occupation. The model then scores ESCO's (public, EU) essential and
optional skills, which have no ratings of their own. Output: data/snapshots/esco_occupations.json, the only
occupation/skill source the live agents read, plus a model card with held-out accuracy.

Evaluation is honest about the transfer: besides held-out occupations we hold out whole capabilities
(unseen items), which is the situation for ESCO skills, and compare against simple baselines.
"""
import io
import json
import sys
import re
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
from torch import nn
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

ZIP = Path("data/raw/onet/db_31_0_text.zip")
RAW = Path("data/snapshots/esco_raw.json")
OUT = Path("data/snapshots/esco_occupations.json")
CARD = Path("data/snapshots/esco_requirements_card.json")
FILES = ["Essential Skills.txt", "Transferable Skills.txt", "Knowledge.txt", "Work Activities.txt", "Abilities.txt"]
SEED = 2026
# scenario anchors (team assumption, written here, not taken from O*NET): which capabilities agentic AI shifts
UP = ["make judgements and decisions", "evaluate and analyse complex systems", "think critically", "solve complex problems",
      "supervise automated processes and check results", "ensure compliance and safety", "learn new technologies"]
DOWN = ["operate machinery routinely", "perform repetitive data entry", "process routine documents", "monitor gauges and readings",
        "sort and file records", "perform routine calculations"]
VENDOR = re.compile(r"\b(microsoft|adobe|sap|oracle|google|amazon|aws|autocad|excel|sql|python|java|javascript|linux|"
                    r"salesforce|tableau|power bi|photoshop|epic|cisco|ibm|unix|android|ios|c\+\+|c#|php|matlab|r)\b", re.I)


def embed(texts):
    from mcp_server.retrieval import _embed
    out = []
    for i in range(0, len(texts), 512):
        out += _embed(texts[i:i + 512])
    return np.asarray(out, np.float32)


def read(z, name):
    rows = z.read(f"db_31_0_text/{name}").decode("utf-8", "replace").splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


def load_onet():
    z = zipfile.ZipFile(ZIP)
    occ = {r["O*NET-SOC Code"]: f"{r['Title']}. {r['Description']}" for r in read(z, "Occupation Data.txt")}
    defs = {r["Element ID"]: (r["Element Name"], r["Description"]) for r in read(z, "Content Model Reference.txt")}
    pairs = defaultdict(dict)
    for f in FILES:
        for r in read(z, f):
            if r.get("Recommend Suppress") == "Y" or r["Scale ID"] not in ("IM", "LV"):
                continue
            pairs[(r["O*NET-SOC Code"], r["Element ID"])][r["Scale ID"]] = float(r["Data Value"])
    rows = [(o, e, v["IM"], v["LV"]) for (o, e), v in pairs.items() if "IM" in v and "LV" in v and o in occ and e in defs]
    return occ, defs, rows


class Net(nn.Module):
    def __init__(self, d=384, h=256):
        super().__init__()
        self.f = nn.Sequential(nn.Linear(4 * d, h), nn.GELU(), nn.Dropout(0.1), nn.Linear(h, h // 2), nn.GELU(), nn.Linear(h // 2, 2))

    def forward(self, o, e):
        return self.f(torch.cat([o, e, o * e, (o - e).abs()], -1))


def train(O, E, y, idx, epochs=12, dev="cpu"):
    torch.manual_seed(SEED)
    net = Net().to(dev)
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    O, E, y = (torch.tensor(a, device=dev) for a in (O, E, y))
    idx = torch.tensor(idx, device=dev)
    for _ in range(epochs):
        perm = idx[torch.randperm(len(idx), device=dev)]
        for b in perm.split(1024):
            oi, ei = b // E.shape[0], b % E.shape[0]
            loss = nn.functional.smooth_l1_loss(net(O[oi], E[ei]), y[b])
            opt.zero_grad(); loss.backward(); opt.step()
    return net.eval()


def predict(net, O, E, oi, ei, dev="cpu"):
    with torch.no_grad():
        out = [net(torch.tensor(O[a], device=dev), torch.tensor(E[b], device=dev)).cpu().numpy()
               for a, b in zip(np.array_split(oi, max(1, len(oi) // 4096)), np.array_split(ei, max(1, len(ei) // 4096)))]
    return np.concatenate(out)


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


ANCHOR_SIM, ANCHOR_MARGIN = 0.45, 0.08


def agentic_tags(SE: np.ndarray) -> np.ndarray:
    """+1 judgement/oversight skill, -1 routine operation skill, 0 otherwise: only clear anchor matches count."""
    up, down = (SE @ embed(UP).T).max(1), (SE @ embed(DOWN).T).max(1)
    return np.where((up >= ANCHOR_SIM) & (up - down >= ANCHOR_MARGIN), 1,
                    np.where((down >= ANCHOR_SIM) & (down - up >= ANCHOR_MARGIN), -1, 0))


def retag():
    """Recompute only the scenario tags on an existing snapshot (no retraining)."""
    d = json.loads(OUT.read_text(encoding="utf-8"))
    names = sorted({k for o in d["occupations"].values() for k in o["skills"]})
    tag = dict(zip(names, agentic_tags(embed(names)).tolist()))
    for o in d["occupations"].values():
        for k, v in o["skills"].items():
            v["agentic"] = int(tag[k])
    OUT.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    vals = list(tag.values())
    print(f"tags: +1 {vals.count(1)}, -1 {vals.count(-1)}, 0 {vals.count(0)}")


def main():
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    occ, defs, rows = load_onet()
    socs, eids = sorted(occ), sorted({r[1] for r in rows})
    si, ei = {s: i for i, s in enumerate(socs)}, {e: i for i, e in enumerate(eids)}
    print(f"O*NET training pairs: {len(rows)} ({len(socs)} occupations x {len(eids)} capabilities)")
    O = embed([occ[s] for s in socs])
    E = embed([defs[e][0] for e in eids])  # name only: matches ESCO's short skill labels
    flat = np.array([si[o] * len(eids) + ei[e] for o, e, _, _ in rows])
    y = np.zeros((len(socs) * len(eids), 2), np.float32)
    y[flat] = np.array([[(im - 1) / 4, lv / 7] for _, _, im, lv in rows], np.float32)

    rng = np.random.default_rng(SEED)
    card = {"created": date.today().isoformat(), "trained_on": "O*NET 31.0 Skills, Knowledge, Work Activities, Abilities "
            "(importance + level ratings); training data only", "pairs": len(rows), "splits": {}}
    for split in ("held_out_occupations", "held_out_capabilities"):
        if split == "held_out_occupations":
            test_set = set(rng.choice(len(socs), len(socs) // 5, replace=False))
            is_test = np.array([si[o] in test_set for o, _, _, _ in rows])
        else:
            test_set = set(rng.choice(len(eids), len(eids) // 5, replace=False))
            is_test = np.array([ei[e] in test_set for _, e, _, _ in rows])
        net = train(O, E, y, flat[~is_test], dev=dev)
        t = flat[is_test]
        p = predict(net, O, E, t // len(eids), t % len(eids), dev)
        truth = y[t]
        if split == "held_out_occupations":  # baseline: the capability's mean over training occupations
            tr = flat[~is_test]
            sums = np.zeros((len(eids), 2)); cnt = np.zeros(len(eids))
            np.add.at(sums, tr % len(eids), y[tr]); np.add.at(cnt, tr % len(eids), 1)
            base = sums[t % len(eids)] / np.maximum(cnt[t % len(eids)], 1)[:, None]
            base_name = "capability mean"
        else:  # unseen capability: baseline is the occupation's mean over its known capabilities
            tr = flat[~is_test]
            sums = np.zeros((len(socs), 2)); cnt = np.zeros(len(socs))
            np.add.at(sums, tr // len(eids), y[tr]); np.add.at(cnt, tr // len(eids), 1)
            base = sums[t // len(eids)] / np.maximum(cnt[t // len(eids)], 1)[:, None]
            base_name = "occupation mean"
        mae = lambda a: [float(np.abs(a[:, 0] - truth[:, 0]).mean() * 4), float(np.abs(a[:, 1] - truth[:, 1]).mean() * 7)]
        card["splits"][split] = {"n": int(is_test.sum()), "mae_importance_1to5": round(mae(p)[0], 3), "mae_level_0to7": round(mae(p)[1], 3),
                                 "baseline": base_name, "baseline_mae_importance": round(mae(base)[0], 3),
                                 "baseline_mae_level": round(mae(base)[1], 3),
                                 "spearman_importance": round(spearman(p[:, 0], truth[:, 0]), 3),
                                 "baseline_spearman_importance": round(spearman(base[:, 0], truth[:, 0]), 3)}
        print(split, card["splits"][split])

    net = train(O, E, y, flat, dev=dev)  # final model on all O*NET pairs
    Path("artifacts").mkdir(exist_ok=True)
    torch.save(net.state_dict(), "artifacts/esco_requirement_model.pt")

    raw = json.loads(RAW.read_text(encoding="utf-8"))
    occs, skills = raw["occupations"], raw["skills"]
    ids = list(occs)
    sk_ids = sorted(skills)
    label = lambda s: s[:1].upper() + s[1:]
    OE = embed([f"{occs[i]['title']}. {occs[i]['description']}" for i in ids])
    SE = embed([skills[s]["title"] for s in sk_ids])
    sk_pos = {s: k for k, s in enumerate(sk_ids)}
    agentic = agentic_tags(SE)
    out = {}
    for n, oid in enumerate(ids):
        o = occs[oid]
        items = [(s, True) for s in o["essential"]] + [(s, False) for s in o["optional"] if s not in o["essential"]]
        items = [(s, ess) for s, ess in items if s in sk_pos]
        if not items:
            continue
        p = predict(net, OE, SE, np.full(len(items), n), np.array([sk_pos[s] for s, _ in items]), dev)
        req = {}
        for (s, ess), (im, lv) in zip(items, p):
            imp = float(np.clip(1 + 4 * im, 1, 5))
            lvl = int(np.clip(round(lv * 7 * 5 / 7), 1, 5))
            a = int(agentic[sk_pos[s]])
            req[label(skills[s]["title"])] = {"id": s, "importance": round(imp if ess else imp * 0.7, 2),
                                              "required": lvl if ess else max(1, lvl - 1), "essential": ess,
                                              "type": skills[s]["type"], "agentic": a}
        req = dict(sorted(req.items(), key=lambda kv: (not kv[1]["essential"], -kv[1]["importance"])))
        isco = o["isco"]
        major = isco[:1]
        skill_level = {"1": 4, "2": 4, "3": 3, "9": 1, "0": 2}.get(major, 2)  # ISCO-08 skill level by major group
        tech = [{"name": k, "hot": False, "in_demand": False} for k, v in req.items()
                if v["type"] == "knowledge" and VENDOR.search(k)]
        out[o["code"] or oid] = {"title": label(o["title"]), "uri": oid, "isco": isco, "description": o["description"],
                                 "job_zone": skill_level, "tasks": [], "skills": req, "tech": tech, "alt": o["alt"]}
    titles = sorted({(a, code) for code, o in out.items() for a in o.pop("alt")})
    OUT.write_text(json.dumps({"meta": raw["meta"] | {"levels": "predicted by a model trained on O*NET ratings",
                                                       "built": date.today().isoformat()},
                               "occupations": out, "titles": [list(t) for t in titles]}, ensure_ascii=False), encoding="utf-8")
    card["esco"] = {"occupations": len(out), "skills_scored": int(sum(len(o["skills"]) for o in out.values()))}
    CARD.write_text(json.dumps(card, indent=1), encoding="utf-8")
    print(f"{len(out)} ESCO occupations -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB); card -> {CARD}")


if __name__ == "__main__":
    retag() if "--retag" in sys.argv else main()
