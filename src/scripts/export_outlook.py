"""Export the trained STF-KAN (O*NET history) as the live agents' skill-outlook asset.

    python scripts/export_outlook.py --ckpt artifacts/stf_kan_best.pt
Runs OFFLINE after training: reads the training series once, predicts the next releases for every
(occupation, requirement) the live app uses, and writes data/training_snapshots/onet_outlook.json. At runtime the
Market Analyst reads only this file (model output), never the training data.

Direction rule (conservative): a flag is only ever set for a kind x direction where STF-KAN out-ranked both
non-learned heuristics on VALIDATION (scripts/eval_direction.py). Then a skill is "rising"/"falling" when
the forecast change exceeds the model's 80% validation-error band (and >= 0.05 importance points); a tool when
its Hot flag forecast crosses 50%. Otherwise "stable". Forecast values always come from the trained ensemble.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecasting.datasets import ONET_RELEASE_DATES, load_onet_series  # noqa: E402
from forecasting.inference import load_model  # noqa: E402
from forecasting.serving import latest_batch, predict, record, rule_from, write_manifest  # noqa: E402
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

OUT = Path("data/training_snapshots/onet_outlook.json")


def next_releases(last: str, n: int) -> list[str]:
    M, m = map(int, last.split("."))
    out = []
    for _ in range(n):
        M, m = (M + 1, 0) if m == 3 else (M, m + 1)
        out.append(f"{M}.{m}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="artifacts/stf_kan_best.pt")
    ap.add_argument("--data", default="data/training/onet_history.csv")
    a = ap.parse_args()
    model, ck = load_model(a.ckpt)
    assert ck.get("dataset") == "onet", "checkpoint was not trained on the O*NET history"
    s = load_onet_series(a.data)
    assert [tuple(k) for k in ck["keys"]] == s.keys, "series set differs from training"
    H = ck["horizon"]
    rows = np.arange(len(s.keys))
    b, x, mask = latest_batch(s, ck, rows)
    pred = predict(model, ck, b)  # same functions as live CPU serving (forecasting/serving.py)
    rule = rule_from(Path(a.ckpt), ck)
    drep, enabled = rule["drep"], rule["enabled"]

    snap = json.loads(Path("data/training_snapshots/onet_occupations.json").read_text(encoding="utf-8"))["occupations"]
    wanted = {(soc, name, "skill") for soc, o in snap.items() for name in o["skills"]} | \
             {(soc, t["name"], "tool") for soc, o in snap.items() for t in o["tech"]}
    occ: dict = {}
    counts = {"rising": 0, "falling": 0, "stable": 0}
    for i, (soc, item, kind) in enumerate(s.keys):
        if (soc, item, kind) not in wanted or not mask[i, -1]:
            continue
        rec = record(kind, float(x[i, -1]), pred[i], rule)
        direction = rec["direction"]
        counts[direction] += 1
        occ.setdefault(soc, {})[item] = rec
    man = json.loads((Path(a.ckpt).parent / "ensemble_report.json").read_text()) if (Path(a.ckpt).parent / "ensemble_report.json").exists() else {}
    metrics = man.get("metrics", {})
    served = next((k for k in metrics if k.startswith("ensemble:")), "stf_kan:" + ck["variant"])  # forecasts + flags come from the ensemble
    base = man.get("best_baseline_by_val")
    nxt = next_releases(s.weeks[-1], H)
    asset = {"model": {"name": f"STF-KAN ({served})", "trained_on": f"O*NET {s.weeks[0]}-{s.weeks[-1]} release history",
                       "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       "horizon_label": f"O*NET {nxt[-1]} (~{ONET_RELEASE_DATES.get(nxt[-1], '')})",
                       "test_mae": metrics.get(served, {}).get("test", {}).get("global_mae", float("nan")),
                       "baseline_test_mae": metrics.get(base, {}).get("test", {}).get("global_mae", float("nan")),
                       "baseline": base, "units": "skill MAE in importance-scale percentage points (0-100)",
                       "direction_counts": counts, "direction_enabled": enabled,
                       "rising_flag": drep.get("skill_rising_cut"),
                       "direction_test": {k: {"stf_kan_auc": v["stf_kan"]["auc"], "best_heuristic_auc": max(v["companion"]["auc"], v["momentum"]["auc"]),
                                              "events": v["events"]} for k, v in drep.get("test", {}).items()}},
             "occupations": occ}
    OUT.write_text(json.dumps(asset, separators=(",", ":")), encoding="utf-8")
    print(f"{sum(len(v) for v in occ.values())} outlooks for {len(occ)} occupations -> {OUT} "
          f"({OUT.stat().st_size / 1e6:.1f} MB) {counts}")
    print("manifest:", write_manifest(Path(a.ckpt), Path(a.data))["model_version"])


if __name__ == "__main__":
    main()
