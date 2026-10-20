"""Metrics (percentage points) and non-learned baselines.

    python src/forecasting/evaluate.py --checkpoint artifacts/stf_kan_best.pt
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def mae(p, y):
    return float(np.mean(np.abs(p - y)))


def rmse(p, y):
    return float(np.sqrt(np.mean((p - y) ** 2)))


def baseline(name: str, x: np.ndarray, horizon: int = 4) -> np.ndarray:
    if name == "last":
        return np.repeat(x[:, -1:], horizon, 1)
    if name == "ma4":
        return np.repeat(x[:, -4:].mean(1, keepdims=True), horizon, 1)
    if name.startswith("ses"):  # simple exponential smoothing, alpha from the name
        a, level = float(name[3:]), x[:, 0].copy()
        for t in range(1, x.shape[1]):
            level = a * x[:, t] + (1 - a) * level
        return np.repeat(level[:, None], horizon, 1)
    raise ValueError(name)


def fit_linear(x, y, alpha=1.0):
    """Ridge on [window, 1] -> horizon, closed form; train data only."""
    X = np.c_[x, np.ones(len(x))]
    return np.linalg.solve(X.T @ X + alpha * np.eye(X.shape[1]), X.T @ y)


def predict_linear(w, x):
    return np.c_[x, np.ones(len(x))] @ w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="artifacts/stf_kan_best.pt")
    ap.add_argument("--data", default="data/training_snapshots/weekly_skill_demand.csv")
    a = ap.parse_args()
    from forecasting.datasets import load_series, windows
    from forecasting.inference import load_model, predict_batch
    model, meta = load_model(a.checkpoint)
    test = windows(load_series(a.data), "test", meta["window"], meta["horizon"])
    p = predict_batch(model, meta, test)
    print(json.dumps({"checkpoint": a.checkpoint, "n_test": len(test["y"]),
                      "mae": mae(p, test["y"]), "rmse": rmse(p, test["y"]),
                      "last_mae": mae(baseline("last", test["x"]), test["y"])}, indent=1))


if __name__ == "__main__":
    main()
