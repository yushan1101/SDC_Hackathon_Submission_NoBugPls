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
from forecasting.datasets import fit_scale, load_onet_series, load_series, noise_floor_mae, windows  # noqa: E402
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
    model = STFKAN(len(s.roles), len(s.skills), a.window, a.horizon, text_emb=text_emb, variant=variant,
                   ar_init=ar_init, hidden=a.hidden, sem_dim=a.sem_dim, grid=a.grid).to(a.device)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.weight_decay)
    w_all = dev["train_w"]
    val_g = np.array([s.keys[i][2] == s.headline for i in data["val"]["series"]])
    inputs, _, target = dev["train"]
    n = len(target)
    best, best_state, bad = float("inf"), None, 0
    for epoch in range(a.epochs):
        model.train()
        perm = torch.randperm(n, device=a.device)
        for i in range(0, n, a.batch_size):
            idx = perm[i:i + a.batch_size]
            err = (model(*(t[idx] for t in inputs)) - target[idx]).abs()  # L1 = MAE objective
            loss = (err * w_all[idx]).sum() / w_all[idx].sum() if w_all is not None else err.mean()
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
        pv = predict(model, dev["val"], scale)
        val = mae(pv, data["val"]["y"]) if a.select_on == "all" else mae(pv[val_g], data["val"]["y"][val_g])
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
    ap.add_argument("--dataset", default="onet", choices=("onet", "jobs"),
                    help="onet: O*NET release history 2020-2026, all occupations (default); jobs: 2023 job ads")
    ap.add_argument("--data", default=None)
    ap.add_argument("--window", type=int, default=None)
    ap.add_argument("--horizon", type=int, default=None)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--patience", type=int, default=5)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-text", action="store_true", help="skip MiniLM; use learned ID embeddings")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--save-dir", default="artifacts")
    ap.add_argument("--select-on", default="all", choices=("all", "global"),
                    help="validation subset used for early stopping and model selection")
    ap.add_argument("--hidden", type=int, default=16)
    ap.add_argument("--sem-dim", type=int, default=16)
    ap.add_argument("--grid", type=int, default=8)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--loss-weight", default="none", choices=("none", "sqrt_n"),
                    help="sqrt_n: weight windows by sqrt(target-week ads), i.e. down-weight noisy targets")
    ap.add_argument("--global-weight", type=float, default=1.0,
                    help="loss weight of global-series windows relative to country windows (global = what the app serves)")
    a = ap.parse_args()
    onet = a.dataset == "onet"
    a.data = a.data or ("data/training/onet_history.csv" if onet else "data/snapshots/weekly_skill_demand.csv")
    a.window = a.window or (8 if onet else 12)
    a.horizon = a.horizon or (2 if onet else 4)
    t_start = time.time()
    out = Path(a.save_dir); out.mkdir(parents=True, exist_ok=True)

    s = load_onet_series(a.data) if onet else load_series(a.data)
    SPLITS = s.splits
    scale = fit_scale(s)
    data = {k: windows(s, k, a.window, a.horizon) for k in SPLITS}
    print({k: len(v["y"]) for k, v in data.items()}, f"scale={scale:.4f} device={a.device}")

    texts = [prompt_encoder.onet_prompt(*k) if onet else prompt_encoder.prompt(*k) for k in s.keys]
    emb = None if a.no_text else prompt_encoder.encode(texts, out / "embeddings.npz", device=a.device)
    text_emb = None if emb is None else torch.as_tensor(emb)
    semantic_source = f"{prompt_encoder.MODEL_ID}@{prompt_encoder.MODEL_REVISION[:7]}" if emb is not None else "learned role/skill ID embeddings"

    dev = {k: to_device(v, scale, a.device) for k, v in data.items()}
    w = np.ones(len(data["train"]["y"]))
    if a.loss_weight == "sqrt_n":
        w = np.sqrt(np.nan_to_num(data["train"]["n_eligible"], nan=1.0)).mean(1)
    w = w * np.where([s.keys[i][2] == s.headline for i in data["train"]["series"]], a.global_weight, 1.0)
    dev["train_w"] = (torch.as_tensor(w / w.mean(), dtype=torch.float32, device=a.device)[:, None]
                      if a.loss_weight != "none" or a.global_weight != 1.0 else None)
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
    is_global = {sp: np.array([s.keys[i][2] == s.headline for i in data[sp]["series"]]) for sp in ("val", "test")}
    for name in preds:
        results[name] = {sp: {"mae": mae(cache[name, sp], data[sp]["y"]), "rmse": rmse(cache[name, sp], data[sp]["y"]),
                              "global_mae": mae(cache[name, sp][is_global[sp]], data[sp]["y"][is_global[sp]])}
                         for sp in ("val", "test")}
    floor = {sp: {"all": noise_floor_mae(data[sp]),
                  "global": noise_floor_mae({k: v[is_global[sp]] for k, v in data[sp].items()})} for sp in ("val", "test")}

    # go/no-go: choose by VALIDATION only; test is reported, never used for selection
    key = "mae" if a.select_on == "all" else "global_mae"
    selected = min(results, key=lambda k: results[k]["val"][key])
    best_learned = min(models, key=lambda v: results[f"stf_kan:{v}"]["val"][key])
    interval = interval_q(cache[selected, "val"], data["val"]["y"])  # for the predictor actually served
    t_pred = cache[selected, "test"]
    lo, hi = t_pred - interval, t_pred + interval
    coverage = float(((data["test"]["y"] >= lo) & (data["test"]["y"] <= hi)).mean())
    m = models[best_learned].cpu()
    n_params = {v: sum(q.numel() for q in mm.parameters() if q.requires_grad) for v, mm in models.items()}
    torch.save({"state_dict": m.state_dict(), "variant": best_learned, "roles": s.roles, "skills": s.skills,
                "keys": s.keys, "window": a.window, "horizon": a.horizon, "scale": scale,
                "text_emb": text_emb, "selected": selected, "linear_w": w_lin,
                "interval_q80_pp": interval, "dataset": a.dataset, "headline": s.headline,
                "hparams": {"hidden": a.hidden, "sem_dim": a.sem_dim, "grid": a.grid}}, out / "stf_kan_best.pt")
    for v, mm in models.items():  # every variant kept so ensembles can be assembled later
        torch.save(mm.cpu().state_dict(), out / f"variant_{v}.pt")
    (out / "scaler.json").write_text(json.dumps({"type": "window_mean_center / train_diff_std",
                                                 "scale": scale, "fit_on": SPLITS["train"]}))
    (out / "feature_schema.json").write_text(json.dumps({
        "window": a.window, "horizon": a.horizon,
        "target": "O*NET importance rescaled 0-100 (skills) / Hot Technology x100 (tools)" if onet else "mention_percent (pp)",
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
    data_line = ("- Data: O*NET release history 25.0 (Aug 2020) .. 31.0 (Aug 2026), CC BY 4.0, every rated occupation;\n"
                 f"  {len(s.keys)} series (occupation x skill importance / tool Hot flag). Headline = skill series."
                 if onet else f"- Data: hf:Ashy24/data_jobs 2023 job ads; {len(s.keys)} series. Headline = global series.")
    (out / "model_card.md").write_text(f"""# STF-KAN forecaster ({a.dataset}) — training/evaluation artifact

{data_line}
- Window {a.window} -> horizon {a.horizon} steps. Training data is never read by the live agents.
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
