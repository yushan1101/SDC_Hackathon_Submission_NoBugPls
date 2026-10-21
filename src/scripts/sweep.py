"""One-factor-at-a-time hyperparameter sweep for STF-KAN, scored on VALIDATION MAE only.

    python scripts/sweep.py --device cuda --out checkpoints/sweep
Then combines every factor that beat the base config and evaluates that too. Writes sweep_results.json.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

BASE = {"hidden": 16, "sem-dim": 16, "grid": 8, "lr": 1e-3, "batch-size": 64, "weight-decay": 1e-4,
        "loss-weight": "none", "epochs": 30, "patience": 5}
CHANGES = [{"hidden": 32}, {"hidden": 64}, {"sem-dim": 32}, {"grid": 5}, {"grid": 12}, {"lr": 3e-3}, {"lr": 3e-4},
           {"batch-size": 256, "lr": 2e-3}, {"weight-decay": 1e-3}, {"loss-weight": "sqrt_n"},
           {"epochs": 60, "patience": 8}, {"batch-size": 512, "lr": 3e-3}]

ap = argparse.ArgumentParser()
ap.add_argument("--device", default="cuda")
ap.add_argument("--out", default="checkpoints/sweep")
ap.add_argument("--seed", default="42")
a = ap.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)


def run(name, cfg):
    d = out / name
    if not (d / "training_manifest.json").exists():
        args = [x for k, v in cfg.items() for x in (f"--{k}", str(v))]
        subprocess.run([sys.executable, "forecasting/train.py", "--device", a.device, "--seed", a.seed, "--model", "stf_kan",
                        "--save-dir", str(d)] + args, check=True, stdout=subprocess.DEVNULL)
    m = json.loads((d / "training_manifest.json").read_text())
    learned = {k: v for k, v in m["metrics"].items() if k.startswith("stf_kan:")}
    best = min(learned, key=lambda k: learned[k]["val"]["mae"])
    r = {"name": name, "cfg": cfg, "best_variant": best, "val_mae": learned[best]["val"]["mae"],
         "val_global_mae": learned[best]["val"]["global_mae"], "train_seconds": m["train_seconds"]}
    print(f"{name:28s} {best:22s} val {r['val_mae']:.4f}  val_global {r['val_global_mae']:.4f}  {m['train_seconds']}", flush=True)
    return r


results = [run("base", BASE)]
for ch in CHANGES:
    results.append(run("_".join(f"{k}{v}" for k, v in ch.items()), BASE | ch))
winners = [r["cfg"] for r in results[1:] if r["val_mae"] < results[0]["val_mae"]]
combo = dict(BASE)
for w in winners:  # later winners override earlier ones on the same key
    combo.update({k: v for k, v in w.items() if BASE.get(k) != v})
if winners:
    results.append(run("combined", combo))
best = min(results, key=lambda r: r["val_mae"])
(out / "sweep_results.json").write_text(json.dumps({"results": results, "best": best}, indent=1))
print("BEST:", best["name"], best["cfg"])
