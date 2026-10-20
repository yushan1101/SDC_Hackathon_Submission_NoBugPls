"""Directional skill of the O*NET outlook model: can it rank the rare real changes? (val + test)

    python scripts/eval_direction.py --ckpt artifacts/onet/stf_kan_best.pt
Event = item moves by > 1 point (0-100 scale) by the last horizon step. Scores:
  stf_kan     : forecast change of the trained ensemble
  companion   : recent slope of the item's cross-occupation mean (fair non-learned heuristic)
  momentum    : the item's own change over the input window
AUC = how well the score ranks real rising (or falling) events above non-events. Persistence has no score (0.5).
Writes direction_report.json next to the checkpoint; export_outlook.py only flags directions if stf_kan wins
on VALIDATION for that direction.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecasting.datasets import load_onet_series, windows  # noqa: E402
from forecasting.inference import load_model, predict_batch  # noqa: E402

THRESH = 1.0


def scores(model, ck, b):
    pred = np.concatenate([predict_batch(model, ck, {k: v[i:i + 8192] for k, v in b.items()}) for i in range(0, len(b["y"]), 8192)])
    return {"stf_kan": pred[:, -1] - b["x"][:, -1],
            "companion": b["xg"][:, -1] - b["xg"][:, -4],
            "momentum": b["x"][:, -1] - b["x"][:, 0]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="artifacts/onet/stf_kan_best.pt")
    a = ap.parse_args()
    model, ck = load_model(a.ckpt)
    s = load_onet_series()
    kinds = np.array([k[2] for k in s.keys])
    report = {}
    for split in ("val", "test"):
        b = windows(s, split, ck["window"], ck["horizon"])
        change = b["y"][:, -1] - b["x"][:, -1]
        sc = scores(model, ck, b)
        for kind in ("skill", "tool"):
            m = kinds[b["series"]] == kind
            for direction, sign in (("rising", 1), ("falling", -1)):
                ev = (sign * change[m]) > THRESH
                if ev.sum() < 5 or (~ev).sum() < 5:
                    continue
                r = {"events": int(ev.sum()), "n": int(m.sum())}
                for name, v in sc.items():
                    r[name] = {"auc": round(float(roc_auc_score(ev, sign * v[m])), 4),
                               "ap": round(float(average_precision_score(ev, sign * v[m])), 4)}
                report.setdefault(split, {})[f"{kind}:{direction}"] = r
    # flag cut-off for rising skills: top-q% of the model's forecast change, q chosen on VALIDATION
    # (max lift with >= 1000 flagged windows); lift is then reported on the untouched test split
    cut = {}
    for split in ("val", "test"):
        b = windows(s, split, ck["window"], ck["horizon"])
        m = kinds[b["series"]] == "skill"
        sc = scores(model, ck, b)["stf_kan"][m]
        ev = (b["y"][:, -1] - b["x"][:, -1])[m] > THRESH
        if split == "val":
            opts = [(q, np.percentile(sc, 100 - q)) for q in (0.5, 1, 2, 5, 10)]
            opts = [(q, thr, ev[sc >= thr].mean() / ev.mean()) for q, thr in opts if (sc >= thr).sum() >= 1000]
            q, thr, lift = max(opts, key=lambda o: o[2])
            cut = {"top_percent": q, "threshold_pp": float(thr), "val_lift": round(float(lift), 3)}
        else:
            cut["test_lift"] = round(float(ev[sc >= cut["threshold_pp"]].mean() / ev.mean()), 3)
            cut["test_base_rate"] = round(float(ev.mean()), 4)
    report["skill_rising_cut"] = cut
    # direction is enabled only when STF-KAN beats BOTH heuristics on validation AUC
    report["enabled"] = {k: bool(v["stf_kan"]["auc"] > max(v["companion"]["auc"], v["momentum"]["auc"]) and v["stf_kan"]["auc"] > 0.55)
                         for k, v in report.get("val", {}).items()}
    out = Path(a.ckpt).parent / "direction_report.json"
    out.write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
