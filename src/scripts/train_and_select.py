"""Train N seeds, build a deep ensemble of the best variant, run go/no-go vs baselines on VALIDATION.

    python scripts/train_and_select.py --seeds 42 7 2026 11 99 --out artifacts -- --device cuda --hidden 32

Everything after `--` is passed to forecasting/train.py. Test metrics are reported, never used to choose.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecasting.datasets import fit_scale, load_onet_series, load_series, windows  # noqa: E402
from forecasting.evaluate import mae, rmse  # noqa: E402
from forecasting.inference import load_model  # noqa: E402
from forecasting.train import interval_q, predict, to_device  # noqa: E402
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

ap = argparse.ArgumentParser()
ap.add_argument("--seeds", nargs="+", default=["42", "7", "2026"])
ap.add_argument("--out", default="artifacts")
ap.add_argument("--work", default="checkpoints")
ap.add_argument("--dataset", default="onet", choices=("onet", "jobs"))
ap.add_argument("--data", default=None)
ap.add_argument("--select-on", default="all", choices=("all", "global"), help="validation subset for go/no-go")
a, extra = ap.parse_known_args()
extra = [x for x in extra if x != "--"]

runs = {}
for seed in a.seeds:
    d = Path(a.work) / f"seed{seed}"
    if not (d / "training_manifest.json").exists():  # reuse finished seeds (re-evaluation only)
        subprocess.run([sys.executable, "forecasting/train.py", "--seed", seed, "--save-dir", str(d), "--dataset", a.dataset]
                       + (["--data", a.data] if a.data else []) + extra,
                       check=True)
    runs[seed] = (d, json.loads((d / "training_manifest.json").read_text()))

# variant with the best MEAN validation MAE across seeds
learned = [k for k in runs[a.seeds[0]][1]["metrics"] if k.startswith("stf_kan:")]
key = "mae" if a.select_on == "all" else "global_mae"
variant = min(learned, key=lambda k: np.mean([m["metrics"][k]["val"][key] for _, m in runs.values()])).split(":")[1]

base_dir, base_m = runs[a.seeds[0]]
ck = torch.load(base_dir / "stf_kan_best.pt", map_location="cpu", weights_only=False)
ck["members"] = [{k: v for k, v in torch.load(runs[s][0] / f"variant_{variant}.pt", map_location="cpu").items()
                  if k != "text_emb"} for s in a.seeds]  # embedding table kept once in ck["text_emb"]
ck["variant"] = variant
ck.pop("state_dict", None)

cfg = runs[a.seeds[0]][1]["config"]
s = load_onet_series(cfg["data"]) if a.dataset == "onet" else load_series(cfg["data"])
scale = fit_scale(s)
data = {k: windows(s, k, cfg["window"], cfg["horizon"]) for k in ("val", "test")}
tmp = Path(a.work) / "ensemble.pt"
torch.save(ck, tmp)
model, _ = load_model(tmp)
dev = {k: to_device(v, scale, "cpu") for k, v in data.items()}
pred = {k: predict(model, dev[k], scale) for k in data}
is_g = {k: np.array([s.keys[i][2] == s.headline for i in data[k]["series"]]) for k in data}
ens = {k: {"mae": mae(pred[k], data[k]["y"]), "rmse": rmse(pred[k], data[k]["y"]),
           "global_mae": mae(pred[k][is_g[k]], data[k]["y"][is_g[k]])} for k in data}

metrics = dict(base_m["metrics"])
seeds_summary = {k: {sp: [round(float(np.mean(v)), 4), round(float(np.std(v)), 4)]
                     for sp, v in {sp: [m["metrics"][k][sp]["mae"] for _, m in runs.values()] for sp in ("val", "test")}.items()}
                 for k in metrics}
metrics[f"ensemble:{variant}x{len(a.seeds)}"] = ens
baselines = {k: v for k, v in metrics.items() if k.startswith("baseline:")}
best_base = min(baselines, key=lambda k: baselines[k]["val"][key])
serve_ensemble = ens["val"][key] < baselines[best_base]["val"][key]  # go/no-go on validation only
selected = f"ensemble:{variant}x{len(a.seeds)}" if serve_ensemble else best_base

ck["selected"] = "stf_kan:ensemble" if serve_ensemble else best_base
# separate 80% bands for global vs country series (their error scales differ ~2x); from validation only
ck["interval_q80_pp"] = {g: interval_q(pred["val"][m], data["val"]["y"][m]) for g, m in
                         ((s.headline, is_g["val"]), ("other", ~is_g["val"]))}
coverage = {}
for g, m in ((s.headline, is_g["test"]), ("other", ~is_g["test"])):
    q = np.asarray(ck["interval_q80_pp"][g])
    yt, pt = data["test"]["y"][m], pred["test"][m]
    coverage[g] = float(((yt >= pt - q) & (yt <= pt + q)).mean())
if not serve_ensemble:
    ck["interval_q80_pp"] = base_m["interval_q80_pp"]

shutil.rmtree(a.out, ignore_errors=True)
shutil.copytree(base_dir, a.out)
for f in Path(a.out).glob("variant_*.pt"):
    f.unlink()
torch.save(ck, Path(a.out) / "stf_kan_best.pt")
report = {"seeds": a.seeds, "train_args": extra, "select_on": a.select_on, "ensemble_variant": variant, "selected_by_val": selected,
          "best_baseline_by_val": best_base, "test_interval_coverage": coverage, "interval_q80_pp": ck["interval_q80_pp"],
          "noise_floor_mae": base_m["noise_floor_mae"], "per_seed_mean_std_mae": seeds_summary,
          "metrics": {k: v for k, v in metrics.items()},
          "gpu": base_m.get("gpu"), "train_seconds_per_seed": base_m.get("train_seconds")}
(Path(a.out) / "ensemble_report.json").write_text(json.dumps(report, indent=1))
rows = "\n".join(f"| {k} | {r['val']['mae']:.4f} | {r['val']['global_mae']:.4f} | {r['test']['mae']:.4f} | {r['test']['global_mae']:.4f} |"
                 for k, r in metrics.items())
with open(Path(a.out) / "model_card.md", "a", encoding="utf-8") as f:
    f.write(f"""
## Served model: {selected}
Deep ensemble of {len(a.seeds)} seeds ({', '.join(a.seeds)}) of variant `{variant}`, train args `{' '.join(extra)}`.
Go/no-go on validation ({a.select_on} series): ensemble {ens['val'][key]:.4f} vs best baseline {best_base}
{baselines[best_base]['val'][key]:.4f} -> {'serve ensemble' if serve_ensemble else 'serve baseline'}.
80% interval test coverage {', '.join(f'{g} {c:.1%}' for g, c in coverage.items())}. Noise floor (test) {base_m['noise_floor_mae']['test']}.

| model | val all | val global | test all | test global |
|---|---|---|---|---|
{rows}
""")
print(json.dumps({"selected": selected, "ensemble": ens, "best_baseline": {best_base: baselines[best_base]},
                  "coverage": coverage}, indent=1))
