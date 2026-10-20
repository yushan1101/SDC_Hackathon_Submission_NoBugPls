"""CPU-safe inference: checkpoint if it loads, else labeled baseline, else unavailable."""
from functools import lru_cache
from pathlib import Path

import numpy as np

from forecasting.evaluate import baseline

DEFAULT_CKPT = Path("artifacts/stf_kan_best.pt")


LOGN_SCALE = 8.0  # log1p(ads/week) ~ 0..9


def to_tensors(b: dict, scale: float, device="cpu"):
    """Center each window on its own mean; the pooled global window is centered on the same value."""
    import torch
    center = b["x"].mean(1, keepdims=True)
    t = lambda a, dt=torch.float32: torch.as_tensor(a, dtype=dt, device=device)
    xg = b.get("xg", b["x"])
    logn = b.get("logn", np.zeros_like(b["x"]))
    return (t((b["x"] - center) / scale), t(b["mask"]), t((xg - center) / scale), t(logn / LOGN_SCALE),
            t(b["role"], torch.long), t(b["skill"], torch.long), t(b["series"], torch.long)), center


@lru_cache(maxsize=1)
def _default_series():
    from forecasting.datasets import load_series
    return load_series()


@lru_cache(maxsize=4)
def _load_model_cached(path: str, mtime: float):
    return load_model(path)


def load_model(path=DEFAULT_CKPT):
    import torch
    from forecasting.model import STFKAN
    from forecasting.model import Ensemble
    ck = torch.load(path, map_location="cpu", weights_only=False)
    hp = ck.get("hparams", {})

    def build(sd):
        m = STFKAN(len(ck["roles"]), len(ck["skills"]), ck["window"], ck["horizon"], text_emb=ck.get("text_emb"),
                   variant=ck["variant"], hidden=hp.get("hidden", 16), sem_dim=hp.get("sem_dim", 16),
                   grid=hp.get("grid", 8))
        if ck.get("text_emb") is not None and "text_emb" not in sd:  # shared table stored once in the checkpoint
            sd = {**sd, "text_emb": ck["text_emb"]}
        m.load_state_dict(sd)
        return m
    m = Ensemble([build(sd) for sd in ck["members"]]) if "members" in ck else build(ck["state_dict"])
    return m.eval(), ck


def predict_batch(model, meta, b: dict) -> np.ndarray:
    import torch
    inputs, center = to_tensors(b, meta["scale"])
    with torch.no_grad():
        out = model(*inputs).numpy()
    return center + meta["scale"] * out  # unclipped: checks run before any clamp


def forecast(role: str, skill: str, as_of_index: int | None = None, series=None, ckpt=DEFAULT_CKPT,
             geography: str = "global") -> dict:
    """4-week forecast after the 12 weeks ending at as_of_index (default: last full window).
    Always a historical 2023 backtest — never a 2026 demand prediction."""
    s = series or _default_series()
    key = (role, skill, geography)
    if key not in s.keys:
        return {"data_quality": "unavailable", "warnings": [f"No series for {role}/{skill}/{geography}"]}
    n = s.keys.index(key)
    v = s.values[n]
    end = len(v) - 4 if as_of_index is None else as_of_index  # leave 4 weeks to compare
    x = v[end - 12:end]
    mask = ~np.isnan(x)
    warnings = ["Historical 2023 backtest of job-ad skill-mention %; not a current-demand prediction."]
    if mask.sum() < 6:
        return {"data_quality": "unavailable", "warnings": warnings + ["Too few observed weeks."]}
    xf = np.where(mask, x, np.nanmean(x))
    g = s.keys.index((role, skill, "global")) if (role, skill, "global") in s.keys else n
    xg = s.values[g, end - 12:end]
    xg = np.where(np.isnan(xg), np.nanmean(xg) if (~np.isnan(xg)).any() else xf.mean(), xg)
    elig = s.eligible[n, end - 12:end] if s.eligible is not None else np.ones(12)
    b = {"x": xf[None], "mask": mask[None].astype(float), "xg": xg[None], "logn": np.log1p(np.nan_to_num(elig))[None],
         "role": np.array([s.roles.index(role)]), "skill": np.array([s.skills.index(skill)]), "series": np.array([n])}
    model_id, interval = "baseline:ma4", None
    pred = np.repeat(xf[-4:].mean(), 4)
    try:
        model, meta = _load_model_cached(str(ckpt), Path(ckpt).stat().st_mtime)
        sel = meta.get("selected", "stf_kan")
        if [tuple(k) for k in meta["keys"]] != s.keys:
            raise ValueError("series mismatch")
        if sel.startswith("stf_kan"):
            pred, model_id = predict_batch(model, meta, b)[0], f"stf_kan:{meta['variant']}"
            if "members" in meta:
                model_id += f" x{len(meta['members'])} ensemble"
        elif sel == "baseline:linear":
            pred, model_id = np.r_[xf, xg, 1] @ meta["linear_w"], sel
        else:
            pred, model_id = baseline(sel.split(":")[1], xf[None])[0], sel
        iq = meta.get("interval_q80_pp")
        if isinstance(iq, dict):  # per-population bands
            iq = iq["global" if geography == "global" else "country"]
        interval = np.asarray(iq) if iq else None
        if not sel.startswith("stf_kan"):
            warnings.append(f"Validation selected {sel} over STF-KAN (go/no-go rule).")
    except Exception as e:  # missing torch/checkpoint must not break the demo
        warnings.append(f"Checkpoint unavailable ({type(e).__name__}); using 4-week moving-average baseline.")
    if (pred < 0).any() or (pred > 100).any():
        warnings.append("Model output outside [0,100] before clipping.")
    # direction derived from the forecast itself (no separate head); 0.5 pp dead-band
    delta = float(pred.mean() - xf[-4:].mean())
    direction = "up" if delta > 0.5 else "down" if delta < -0.5 else "flat"
    lo = hi = None
    if interval is not None:
        lo, hi = np.clip(pred - interval, 0, 100).round(2).tolist(), np.clip(pred + interval, 0, 100).round(2).tolist()
    else:
        warnings.append("No validated error interval (no checkpoint).")
    return {"role_id": role, "geography": geography, "direction": direction, "lower_percent": lo, "upper_percent": hi,
            "interval": "80% historical validation error" if lo else None, "skill_id": skill, "granularity": "weekly", "horizon_weeks": 4,
            "history_weeks": list(s.weeks[end - 12:end]), "history": x.tolist(),
            "target_weeks": list(s.weeks[end:end + 4]), "actual": v[end:end + 4].tolist(),
            "predicted_percent": np.clip(pred, 0, 100).round(2).tolist(),
            "as_of_date": str(s.weeks[end - 1]), "training_data_end": "2023-08-31",
            "model_id": model_id, "data_quality": "sufficient" if mask.all() else "limited",
            "is_historical_backtest": True, "warnings": warnings}
