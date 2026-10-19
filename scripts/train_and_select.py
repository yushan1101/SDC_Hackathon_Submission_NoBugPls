"""Train several seeds, keep the run whose *served* predictor has the lowest validation MAE.

    python scripts/train_and_select.py --seeds 42 7 2026 --out artifacts [--device cuda]
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--seeds", nargs="+", default=["42", "7", "2026"])
ap.add_argument("--out", default="artifacts")
ap.add_argument("--work", default="checkpoints")
ap.add_argument("--device", default=None)
a, extra = ap.parse_known_args()

runs = {}
for seed in a.seeds:
    d = Path(a.work) / f"seed{seed}"
    cmd = [sys.executable, "forecasting/train.py", "--seed", seed, "--save-dir", str(d)] + extra
    if a.device:
        cmd += ["--device", a.device]
    subprocess.run(cmd, check=True)
    m = json.loads((d / "training_manifest.json").read_text())
    runs[seed] = (m["metrics"][m["selected_by_val"]]["val"]["mae"], d, m)

best = min(runs, key=lambda s: runs[s][0])
summary = {k: {sp: [runs[s][2]["metrics"][k][sp]["mae"] for s in runs] for sp in ("val", "test")}
           for k in runs[best][2]["metrics"]}
summary = {k: {sp: [round(float(np.mean(v)), 4), round(float(np.std(v)), 4)] for sp, v in r.items()}
           for k, r in summary.items()}
shutil.rmtree(a.out, ignore_errors=True)
shutil.copytree(runs[best][1], a.out)
(Path(a.out) / "seed_summary.json").write_text(json.dumps({"seeds": a.seeds, "served_seed": best,
                                                             "mean_std_mae": summary}, indent=1))
print("served seed", best, "->", a.out)
print(json.dumps(summary, indent=1))
