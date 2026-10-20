"""Training datasets for STF-KAN (training/evaluation only — never read by the live agents).

Two sources, same window machinery:
- "onet" (default): O*NET release history 25.0 (Aug 2020) .. 31.0 (Aug 2026), every occupation.
  Series = (occupation, skill|tool); value = O*NET importance rescaled to 0-100 (skills) or Hot Technology
  flag x 100 (tools). Companion input = the same item's mean across all occupations at each release.
- "jobs": 2023 weekly job-ad skill-mention % (10 data roles; the earlier experiment).

Splits are by *target* label (release or week): a window belongs to a split only if all its target steps
fall inside it. Inputs may look back into earlier periods (that is the past, not leakage).
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

SPLITS = {"train": ("1900-01-01", "2023-08-31"),
          "val": ("2023-09-01", "2023-10-31"),
          "test": ("2023-11-01", "2099-12-31")}
ONET_SPLITS = {"train": ("25.0", "29.3"), "val": ("30.0", "30.1"), "test": ("30.2", "31.0")}
ONET_RELEASE_DATES = {f"{M}.{m}": f"{2020 + M - 25 + (1 if m >= 2 else 0)}-{['08', '11', '02', '05'][m]}"
                      for M in range(25, 32) for m in range(4)}


def _rel_key(label: str):
    """Release labels compare numerically ("25.3" < "26.0"); ISO dates compare as strings."""
    try:
        a, b = label.split(".")
        return (int(a), int(b))
    except ValueError:
        return label


@dataclass
class Series:
    roles: list[str]
    skills: list[str]
    keys: list[tuple[str, str, str]]  # (role, item, group) per row; group = geography (jobs) or kind (onet)
    weeks: np.ndarray  # (T,) labels: ISO week starts or O*NET release numbers
    values: np.ndarray  # (S, T), NaN = missing
    eligible: np.ndarray | None = None  # (S, T) eligible ads (jobs only), for the sampling-noise floor
    companion: np.ndarray | None = None  # (S, T) pooled input series
    splits: dict = field(default_factory=lambda: SPLITS)
    headline: str = "global"  # group used for headline metrics


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
    v = vals.to_numpy(dtype=float)
    gidx = {(r, k): i for i, (r, k, g) in enumerate(keys) if g == "global"}
    comp = np.stack([v[gidx.get((r, k), i)] for i, (r, k, _) in enumerate(keys)])
    return Series(sorted({k[0] for k in keys}), sorted({k[1] for k in keys}), keys,
                  vals.columns.to_numpy().astype(str), v, elig.to_numpy(dtype=float), comp)


def load_onet_series(path="data/training/onet_history.csv", kinds=("skill", "tool")) -> Series:
    df = pd.read_csv(path, dtype={"soc": str, "item": str, "kind": str})
    df = df[df["kind"].isin(kinds)].sort_values(["soc", "item", "kind"]).reset_index(drop=True)
    rels = [c for c in df.columns if c not in ("soc", "item", "kind")]
    v = df[rels].to_numpy(dtype=float)
    skill = (df["kind"] == "skill").to_numpy()
    v[skill] = (v[skill] - 1) / 4 * 100  # importance 1-5 -> 0-100
    v[~skill] *= 100                      # hot flag 0/1 -> 0/100
    comp = pd.DataFrame(v).groupby([df["item"], df["kind"]]).transform("mean").to_numpy()  # cross-occupation mean
    keys = list(zip(df["soc"], df["item"], df["kind"]))
    return Series(sorted(df["soc"].unique()), sorted(df["item"].unique()), keys, np.array(rels), v,
                  None, comp, ONET_SPLITS, "skill")


def fit_scale(s: Series) -> float:
    """Global std of train-period step-to-step changes (train labels only)."""
    hi = _rel_key(s.splits["train"][1])
    train = s.values[:, [_rel_key(w) <= hi for w in s.weeks]]
    sd = float(np.nanstd(np.diff(train, axis=1)))
    return sd if sd > 1e-6 else 1.0


def _fill(x: np.ndarray) -> np.ndarray:
    """Forward-fill inside each window (past only), then any leading gap with the window's observed mean."""
    f = pd.DataFrame(x).ffill(axis=1).to_numpy()
    mean = np.nanmean(np.where(np.isnan(x), np.nan, x), axis=1, keepdims=True)
    return np.nan_to_num(np.where(np.isnan(f), mean, f), nan=0.0)


def windows(s: Series, split: str, window: int = 12, horizon: int = 4):
    """Vectorised. -> dict: x (N,W) filled, mask (N,W), xg (N,W) companion, logn (N,W), y (N,H),
    role, skill, series, t0, n_eligible (N,H)."""
    lo, hi = (_rel_key(b) for b in s.splits[split])
    T = s.values.shape[1]
    n = T - window - horizon + 1
    if n <= 0:
        raise ValueError("series shorter than window + horizon")
    lab = [_rel_key(w) for w in s.weeks]
    ok_t = np.array([lo <= lab[t + window] and lab[t + window + horizon - 1] <= hi for t in range(n)])
    view = lambda a: np.lib.stride_tricks.sliding_window_view(a, window + horizon, axis=1)[:, ok_t]
    W = view(s.values)                                      # (S, nt, W+H)
    S, nt = W.shape[:2]
    X, Y = W[..., :window].reshape(-1, window), W[..., window:].reshape(-1, horizon)
    keep = ~np.isnan(Y).any(1) & ((~np.isnan(X)).sum(1) >= window // 2)
    series = np.repeat(np.arange(S), nt)[keep]
    t0 = np.tile(np.flatnonzero(ok_t), S)[keep]
    X, Y = X[keep], Y[keep]
    C = view(s.companion if s.companion is not None else s.values)[..., :window].reshape(-1, window)[keep]
    C = np.where(np.isnan(C), X, C)
    if s.eligible is not None:
        E = view(s.eligible)
        logn = np.log1p(np.nan_to_num(E[..., :window].reshape(-1, window)[keep]))
        n_el = E[..., window:].reshape(-1, horizon)[keep]
    else:
        logn, n_el = np.zeros_like(X), np.full_like(Y, np.nan)
    ri = {r: i for i, r in enumerate(s.roles)}
    si = {k: i for i, k in enumerate(s.skills)}
    role = np.array([ri[s.keys[i][0]] for i in series], dtype=np.int64)
    skill = np.array([si[s.keys[i][1]] for i in series], dtype=np.int64)
    return {"x": _fill(X), "mask": (~np.isnan(X)).astype(float), "xg": _fill(C), "logn": logn, "y": Y,
            "role": role, "skill": skill, "series": series, "t0": t0, "n_eligible": n_el}


def noise_floor_mae(b: dict) -> float:
    """Expected MAE (pp) of a *perfect* forecaster from binomial sampling noise (job-ad data only).
    NaN for O*NET (expert ratings have no sampling count)."""
    if np.isnan(b["n_eligible"]).all():
        return float("nan")
    p = np.clip(b["y"] / 100, 0, 1)
    return float(np.nanmean(100 * np.sqrt(2 / np.pi) * np.sqrt(p * (1 - p) / b["n_eligible"])))
