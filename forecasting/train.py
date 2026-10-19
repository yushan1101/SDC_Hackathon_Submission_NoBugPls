"""Train STF-KAN ablations against baselines; select on validation, report untouched test.

    python forecasting/train.py --model all --epochs 30 --device cuda --save-dir artifacts
"""
import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecasting import prompt_encoder  # noqa: E402
from forecasting.datasets import SPLITS, fit_scale, load_series, noise_floor_mae, windows  # noqa: E402
from forecasting.evaluate import baseline, fit_linear, mae, predict_linear, rmse  # noqa: E402
from forecasting.inference import to_tensors  # noqa: E402
from forecasting.model import VARIANTS, STFKAN  # noqa: E402


def to_device(b, scale, device):
    """Move a whole split to the device once (no per-batch numpy->tensor copies)."""
    inputs, center = to_tensors(b, scale, device)
    y = torch.as_tensor((b["y"] - center) / scale, dtype=torch.float32, device=device)
    return inputs, center, y


@torch.inference_mode()
def predict(model, dev_split, scale):
    model.eval()
    inputs, center, _ = dev_split
    return center + scale * model(*inputs).cpu().numpy()


def train_variant(variant, data, dev, s, scale, text_emb, a, ar_init=None):
    torch.manual_seed(a.seed); np.random.seed(a.seed)
    model = STFKAN(len(s.roles), len(s.skills), a.window, a.horizon, text_emb=text_emb,
                   variant=variant, ar_init=ar_init).to(a.device)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    inputs, _, target = dev["train"]
    n = len(target)
    best, best_state, bad = float("inf"), None, 0
    for epoch in range(a.epochs):
        model.train()
        perm = torch.randperm(n, device=a.device)
        for i in range(0, n, a.batch_size):
            idx = perm[i:i + a.batch_size]
            loss = torch.nn.functional.l1_loss(model(*(t[idx] for t in inputs)), target[idx])  # = MAE objective
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
        val = mae(predict(model, dev["val"], scale), data["val"]["y"])
        print(f"  [{variant}] epoch {epoch + 1:2d} loss={loss.item():.4f} val_mae={val:.4f}")
        if val < best - 1e-4:
            best, bad = val, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        elif (bad := bad + 1) >= a.patience:
            break
    model.load_state_dict(best_state)
    return model


def interval_q(pred, y, q=0.8):
    """Historical-error interval: per-horizon q-quantile of |error| on validation (pp)."""
    return np.quantile(np.abs(pred - y), q, axis=0).round(3).tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="all", choices=("all",) + VARIANTS)
    ap.add_argument("--data", default="data/snapshots/weekly_skill_demand.csv")
    ap.add_argument("--window", type=int, default=12)
    ap.add_argument("--horizon", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--patience", type=int, default=5)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-text", action="store_true", help="skip MiniLM; use learned ID embeddings")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--save-dir", default="artifacts")
    a = ap.parse_args()
    t_start = time.time()
    out = Path(a.save_dir); out.mkdir(parents=True, exist_ok=True)

    s = load_series(a.data)
    scale = fit_scale(s)
    data = {k: windows(s, k, a.window, a.horizon) for k in SPLITS}
    print({k: len(v["y"]) for k, v in data.items()}, f"scale={scale:.4f} device={a.device}")

    emb = None if a.no_text else prompt_encoder.encode([prompt_encoder.prompt(*k) for k in s.keys],
                                                       out / "embeddings.npz")
    text_emb = None if emb is None else torch.as_tensor(emb)
    semantic_source = f"{prompt_encoder.MODEL_ID}@{prompt_encoder.MODEL_REVISION[:7]}" if emb is not None else "learned role/skill ID embeddings"

    dev = {k: to_device(v, scale, a.device) for k, v in data.items()}
    results = {}
    tr = data["train"]
    xx = lambda b: np.c_[b["x"], b["xg"]]
    w_lin = fit_linear(xx(tr), tr["y"])  # pooled linear: own + matching global window
    c = tr["x"].mean(1, keepdims=True)  # same ridge in the model's scaled/centered space -> AR init
    w_s = fit_linear(np.c_[tr["x"] - c, tr["xg"] - c] / scale, (tr["y"] - c) / scale)
    ar_init = (w_s[:-1], w_s[-1])
    preds = {"baseline:last": lambda sp: baseline("last", data[sp]["x"], a.horizon),
             "baseline:ma4": lambda sp: baseline("ma4", data[sp]["x"], a.horizon),
             "baseline:ses0.2": lambda sp: baseline("ses0.2", data[sp]["x"], a.horizon),
             "baseline:linear": lambda sp: predict_linear(w_lin, xx(data[sp]))}
    models, train_seconds = {}, {}
    for v in (VARIANTS if a.model == "all" else (a.model,)):
        t0 = time.time()
        models[v] = train_variant(v, data, dev, s, scale, text_emb, a, ar_init)
        train_seconds[v] = round(time.time() - t0, 2)
        preds[f"stf_kan:{v}"] = (lambda m: lambda sp: predict(m, dev[sp], scale))(models[v])
    cache = {(name, sp): f(sp) for name, f in preds.items() for sp in ("val", "test")}
    is_global = {sp: np.array([s.keys[i][2] == "global" for i in data[sp]["series"]]) for sp in ("val", "test")}
    for name in preds:
        results[name] = {sp: {"mae": mae(cache[name, sp], data[sp]["y"]), "rmse": rmse(cache[name, sp], data[sp]["y"]),
                              "global_mae": mae(cache[name, sp][is_global[sp]], data[sp]["y"][is_global[sp]])}
                         for sp in ("val", "test")}
    floor = {sp: {"all": noise_floor_mae(data[sp]),
                  "global": noise_floor_mae({k: v[is_global[sp]] for k, v in data[sp].items()})} for sp in ("val", "test")}

    # go/no-go: choose by VALIDATION only; test is reported, never used for selection
    selected = min(results, key=lambda k: results[k]["val"]["mae"])
    best_learned = min(models, key=lambda v: results[f"stf_kan:{v}"]["val"]["mae"])
    interval = interval_q(cache[selected, "val"], data["val"]["y"])  # for the predictor actually served
    t_pred = cache[selected, "test"]
    lo, hi = t_pred - interval, t_pred + interval
    coverage = float(((data["test"]["y"] >= lo) & (data["test"]["y"] <= hi)).mean())
    m = models[best_learned].cpu()
    n_params = {v: sum(q.numel() for q in mm.parameters() if q.requires_grad) for v, mm in models.items()}
    torch.save({"state_dict": m.state_dict(), "variant": best_learned, "roles": s.roles, "skills": s.skills,
                "keys": s.keys, "window": a.window, "horizon": a.horizon, "scale": scale,
                "text_emb": text_emb, "selected": selected, "linear_w": w_lin,
                "interval_q80_pp": interval}, out / "stf_kan_best.pt")
    (out / "scaler.json").write_text(json.dumps({"type": "window_mean_center / train_diff_std",
                                                 "scale": scale, "fit_on": SPLITS["train"]}))
    (out / "feature_schema.json").write_text(json.dumps({
        "window": a.window, "horizon": a.horizon, "target": "mention_percent (pp)",
        "inputs": ["x_scaled[W]", "mask[W]", "trend[3]", "rfft_bins[<=3 amp,phase] (gate only)", "semantic"],
        "roles": s.roles, "skills": s.skills}, indent=1))
    manifest = {
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "checkpoint_variant": best_learned, "selected_by_val": selected, "splits": SPLITS,
        "n_windows": {k: len(v["y"]) for k, v in data.items()}, "config": vars(a),
        "semantic_source": semantic_source, "torch": torch.__version__,
        "gpu": torch.cuda.get_device_name(0) if a.device == "cuda" else None,
        "data_sha256": hashlib.sha256(Path(a.data).read_bytes()).hexdigest(),
        "wall_seconds": round(time.time() - t_start, 1), "train_seconds": train_seconds,
        "trainable_params": n_params, "noise_floor_mae": floor, "n_series": len(s.keys), "interval_q80_pp": interval, "test_interval_coverage": coverage,
        "metrics": results}
    (out / "training_manifest.json").write_text(json.dumps(manifest, indent=1))
    rows = "\n".join(f"| {k} | {r['val']['mae']:.3f} | {r['test']['mae']:.3f} | {r['test']['rmse']:.3f} |"
                     for k, r in results.items())
    (out / "model_card.md").write_text(f"""# STF-KAN skill-mention forecaster (experimental)

- Data: hf:Ashy24/data_jobs (Apache-2.0), job ads 2023-01-01..2023-12-31; {len(s.keys)} series = global + country
  series (role-country pairs averaging >=30 ads/week) x 30 skills. Headline metric = the 300 global series.
- Sampling-noise floor (a perfect forecaster's expected test MAE): all {floor['test']['all']:.3f} pp,
  global {floor['test']['global']:.3f} pp.
- Target: weekly % of eligible job ads mentioning a skill; 12-week input -> 4-week output.
- Splits by target dates: {SPLITS}. Selection on validation only.
- Semantic branch: {semantic_source}. Seed {a.seed}. Device {manifest['gpu'] or a.device}.
- Selected by validation MAE: **{selected}** (checkpoint saved: stf_kan:{best_learned}).
- Architecture: Time-KAN + parameter-free RFFT extrapolation + MiniLM/ID projection, gated fusion, one head.
  Trainable params: {n_params}. Train seconds: {train_seconds}.
- Interval: +/- validation 80th-percentile |error| per horizon {interval} pp; test coverage {coverage:.1%}.

| model | val MAE (pp) | test MAE all series | test MAE global (headline) | test RMSE |
|---|---|---|---|---|
{rows}

**Limits:** single year of data, job-board sampling bias, one seed; a historical 2023 backtest,
not a prediction of 2026 demand. If a baseline is selected, the app should prefer that baseline.
""")
    print(json.dumps({k: round(r["test"]["mae"], 4) for k, r in results.items()}, indent=1))
    print("selected (val):", selected)


if __name__ == "__main__":
    main()
