"""Chronological windows over weekly_skill_demand.csv; scaler fit on train weeks only.

Split by *target* dates (SDLC 5.4): a window belongs to a split only if all 4 target weeks fall
inside it. Inputs may look back into earlier periods (that is the past, not leakage).
Series key = (role, skill, geography); geography "global" is the headline set shown in the app.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

SPLITS = {"train": ("1900-01-01", "2023-08-31"),
          "val": ("2023-09-01", "2023-10-31"),
          "test": ("2023-11-01", "2099-12-31")}


@dataclass
class Series:
    roles: list[str]
    skills: list[str]
    keys: list[tuple[str, str, str]]  # (role, skill, geography) per row
    weeks: np.ndarray  # (T,) str
    values: np.ndarray  # (S, T) mention %, NaN = missing
    eligible: np.ndarray | None = None  # (S, T) eligible ads, for the sampling-noise floor


def load_series(path="data/snapshots/weekly_skill_demand.csv", geographies: set[str] | None = None) -> Series:
    df = pd.read_csv(path)
    if "geography" not in df:
        df["geography"] = "global"
    if geographies:
        df = df[df["geography"].isin(geographies)]
    idx = ["role_id", "skill_id", "geography"]
    vals = df.pivot_table(index=idx, columns="week_start", values="mention_percent", dropna=False).sort_index()
    elig = df.pivot_table(index=idx, columns="week_start", values="eligible_posts", dropna=False).reindex(vals.index)
    keys = [tuple(k) for k in vals.index]
    return Series(sorted({k[0] for k in keys}), sorted({k[1] for k in keys}), keys,
                  vals.columns.to_numpy().astype(str), vals.to_numpy(dtype=float), elig.to_numpy(dtype=float))


def fit_scale(s: Series) -> float:
    """Global std of train-period week-over-week changes (train weeks only)."""
    train = s.values[:, s.weeks <= SPLITS["train"][1]]
    return float(np.nanstd(np.diff(train, axis=1))) or 1.0


def windows(s: Series, split: str, window: int = 12, horizon: int = 4):
    """-> dict of arrays: x (N,W) forward-filled, mask (N,W), xg (N,W) matching global series (pooling),
    logn (N,W) log1p eligible ads per input week, y (N,H), role, skill, series, t0, n_eligible (N,H)."""
    lo, hi = SPLITS[split]
    ri = {r: i for i, r in enumerate(s.roles)}
    si = {k: i for i, k in enumerate(s.skills)}
    out = {k: [] for k in ("x", "mask", "xg", "logn", "y", "role", "skill", "series", "t0", "n_eligible")}
    gidx = {(r, k): i for i, (r, k, g) in enumerate(s.keys) if g == "global"}
    elig = s.eligible if s.eligible is not None else np.ones_like(s.values)
    for n, (role, skill, _) in enumerate(s.keys):
        v = s.values[n]
        vg = s.values[gidx.get((role, skill), n)]
        for t in range(len(v) - window - horizon + 1):
            tgt = slice(t + window, t + window + horizon)
            if not (lo <= s.weeks[tgt][0] and s.weeks[tgt][-1] <= hi) or np.isnan(v[tgt]).any():
                continue
            x = v[t:t + window]
            m = ~np.isnan(x)
            if m.sum() < window // 2:  # too sparse to forecast
                continue
            out["x"].append(_ffill(x))
            out["mask"].append(m.astype(float))
            out["xg"].append(_ffill(vg[t:t + window]))
            out["logn"].append(np.log1p(np.nan_to_num(elig[n, t:t + window])))
            out["y"].append(v[tgt])
            out["role"].append(ri[role]); out["skill"].append(si[skill])
            out["series"].append(n); out["t0"].append(t)
            out["n_eligible"].append(s.eligible[n, tgt] if s.eligible is not None else np.full(horizon, np.nan))
    return {k: np.asarray(a) for k, a in out.items()}


def _ffill(x):
    x = pd.Series(x).ffill().bfill().to_numpy()
    return np.nan_to_num(x, nan=0.0)


def noise_floor_mae(b: dict) -> float:
    """Expected MAE (pp) of a *perfect* forecaster, from binomial sampling noise of each target week:
    E|X - p| ~ sqrt(2/pi) * sqrt(p(1-p)/n). Lower bound on achievable test MAE."""
    p = np.clip(b["y"] / 100, 0, 1)
    return float(np.nanmean(100 * np.sqrt(2 / np.pi) * np.sqrt(p * (1 - p) / b["n_eligible"])))
