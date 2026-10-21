"""Rising-skill ranker (XGBoost) on the O*NET release history; sets the "rising" flags in onet_outlook.json.

    python scripts/train_rising.py                  # CUDA if available, else CPU
    python scripts/train_rising.py --device cpu     # force CPU (same model, slower)
Run AFTER scripts/export_outlook.py (STF-KAN keeps the forecast values; this only replaces the rising flags),
then scripts/export_esco_outlook.py to carry the flags over to ESCO. The live app never loads this model.

Why a separate model: O*NET only re-rates ~10% of occupations once a year (x.3 -> x+1.0), so a skill's own series
says little about direction. The useful signals are cross-sectional: how often this skill (and this skill inside
the same SOC major group) rose at past updates, years since the occupation was last re-surveyed, and its distance
from the cross-occupation mean. All features use data up to the window's last observed release only.

Protocol: hyper-parameters and the flag cut-off are chosen by rolling-origin validation over the last three
annual updates before test (28.0, 29.0, 30.0; train strictly before each); the test split (31.0 update) is scored
once. Same event as scripts/eval_direction.py: importance rises > 1 point (0-100 scale) by the last horizon step.
Two AUCs are reported: overall (includes the easy "no update this quarter" windows) and within-update (only
windows whose horizon contains an annual update; the honest number).
"""
import argparse
import itertools
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecasting.datasets import load_onet_series, windows  # noqa: E402
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

W, H, TH = 8, 2, 1.0
ART = Path("artifacts/onet")
OUTLOOK = Path("data/training_snapshots/onet_outlook.json")
GRID = list(itertools.product((200, 600), (0.03, 0.1), (4, 6)))  # n_estimators, learning_rate, max_depth
UPDATE_PHASE = 3  # (t + 1) % 4 for a window whose next release is an annual x.0 update


class Features:
    def __init__(self, s):
        V = s.values
        soc = np.array([k[0] for k in s.keys]); item = np.array([k[1] for k in s.keys]); grp = np.array([x[:2] for x in soc])
        d = np.nan_to_num(np.diff(V, axis=1, prepend=V[:, :1]))
        cum = lambda m, by: pd.DataFrame(m).groupby(by).transform("sum").cumsum(axis=1).to_numpy()  # past-only counts
        self.s, self.V = s, V
        self.occ_upd = pd.DataFrame(np.abs(d) > 1e-9).groupby(soc).transform("max").to_numpy()
        self.item_mean = s.companion
        self.occ_mean = pd.DataFrame(V).groupby(soc).transform("mean").to_numpy()
        self.up, self.dn = cum(d > TH, item), cum(d < -TH, item)
        self.gup, self.gdn = cum(d > TH, [grp, item]), cum(d < -TH, [grp, item])
        self.item_code, self.grp_code = pd.factorize(item)[0], pd.factorize(grp)[0]

    def at(self, i, t, x, phase=None):
        """Feature matrix for series i whose last observed release index is t; x = filled window (N, W)."""
        T = np.arange(self.occ_upd.shape[1])
        seen = np.where(self.occ_upd[i] & (T[None] <= t[:, None]), T[None], -1).max(1)
        up, dn, gup, gdn = self.up[i, t], self.dn[i, t], self.gup[i, t], self.gdn[i, t]
        return np.c_[x[:, -1], x[:, -1] - self.item_mean[i, t], x[:, -1] - self.occ_mean[i, t], x[:, -1] - x[:, 0],
                     self.item_mean[i, t] - self.item_mean[i, 0], t - seen, (t + 1) % 4 if phase is None else np.full(len(t), phase),
                     up, dn, (up + 1) / (up + dn + 2), gup, gdn, (gup + 1) / (gup + gdn + 2),
                     self.item_code[i], self.grp_code[i]]

    def split(self, name):
        b = windows(self.s, name, W, H)
        i, t = b["series"], b["t0"] + W - 1
        y = (b["y"][:, -1] - b["x"][:, -1]) > TH
        return self.at(i, t, b["x"]), y, t


def fit(X, y, p, device):
    import xgboost as xgb
    return xgb.XGBClassifier(device=device, tree_method="hist", n_estimators=p[0], learning_rate=p[1], max_depth=p[2],
                             subsample=0.8, colsample_bytree=0.8, random_state=0).fit(X, y)


def in_update(t):  # horizon (t+1 .. t+H) contains an annual x.0 release
    return ((t[:, None] + np.arange(1, H + 1)) % 4 == 0).any(1)


def lift_at(y, p, q):
    k = max(1, int(len(p) * q / 100))
    return float(y[np.argsort(-p)[:k]].mean() / y.mean()), k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default=None, help="cuda | cpu (default: cuda if available)")
    a = ap.parse_args()
    if a.device is None:
        import torch
        a.device = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", a.device)

    s = load_onet_series(kinds=("skill",))
    f = Features(s)
    Xtr, ytr, ttr = f.split("train"); Xva, yva, tva = f.split("val")
    X, Y, T = np.r_[Xtr, Xva], np.r_[ytr, yva], np.r_[ttr, tva]
    U = in_update(T)
    folds = sorted({u for u in range(T.max() + H + 1) if u % 4 == 0 and (U & (T < u) & (u <= T + H)).any()})[-3:]
    print("validation updates (release idx):", folds)

    res = []
    for p in GRID:
        aucs, preds = [], []
        for u in folds:  # train only on windows whose horizon ends before the update; validate on that update
            tr, va = T + H < u, U & (T < u) & (u <= T + H)
            pv = fit(X[tr], Y[tr], p, a.device).predict_proba(X[va])[:, 1]
            aucs.append(roc_auc_score(Y[va], pv)); preds.append((Y[va], pv))
        res.append((float(np.mean(aucs)), p, aucs, preds))
        print(f"{p} rolling within-update AUC {np.mean(aucs):.3f} {np.round(aucs, 3)}")
    val_auc, best, fold_aucs, preds = max(res, key=lambda r: r[0])
    # flag cut-off: top-q% of the update's windows, q maximising mean validation lift (>= 300 flags per fold)
    opts = [(q, np.mean([lift_at(y, p, q)[0] for y, p in preds])) for q in (1, 2, 5, 10)
            if all(lift_at(y, p, q)[1] >= 300 for y, p in preds)]
    q, val_lift = max(opts, key=lambda o: o[1])
    print(f"chosen {best}, flag top {q}% (val lift {val_lift:.2f}x)")

    model = fit(X, Y, best, a.device)
    Xte, yte, tte = f.split("test")
    pt = model.predict_proba(Xte)[:, 1]
    ute = in_update(tte)
    test_lift, _ = lift_at(yte[ute], pt[ute], q)
    report = {"model": "XGBoost rising-skill ranker", "device_trained": a.device, "params": dict(zip(("n_estimators", "learning_rate", "max_depth"), best)),
              "validation_updates": [str(s.weeks[u]) for u in folds], "val_within_update_auc": [round(float(x), 4) for x in fold_aucs],
              "test": {"overall_auc": round(float(roc_auc_score(yte, pt)), 4),
                       "within_update_auc": round(float(roc_auc_score(yte[ute], pt[ute])), 4),
                       "events": int(yte.sum()), "n": int(len(yte)), "update_base_rate": round(float(yte[ute].mean()), 4)},
              "flag": {"top_percent": q, "val_lift": round(val_lift, 3), "test_lift": round(test_lift, 3),
                       "test_base_rate": round(float(yte[ute].mean()), 4)}}
    ART.mkdir(parents=True, exist_ok=True)
    model.get_booster().save_model(str(ART / "rising_xgb.json"))  # loads on CPU or GPU
    (ART / "rising_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report["test"]), json.dumps(report["flag"]))

    # score the latest release for the NEXT annual update, flag top-q%, write into the STF-KAN outlook asset
    t = np.full(len(s.keys), f.V.shape[1] - 1)
    x = pd.DataFrame(f.V[:, -W:]).ffill(axis=1).bfill(axis=1).to_numpy()
    ok = ~np.isnan(f.V[:, -1])
    p = np.full(len(s.keys), -np.inf)
    # ponytail: phase pinned to "update next", ranks for the coming x.0 release whatever quarter we export in
    p[ok] = model.predict_proba(f.at(np.flatnonzero(ok), t[ok], x[ok], phase=UPDATE_PHASE))[:, 1]
    cut = np.percentile(p[ok], 100 - q)
    asset = json.loads(OUTLOOK.read_text(encoding="utf-8"))
    counts = {"rising": 0, "falling": 0, "stable": 0}
    for k, (soc, item, _) in enumerate(s.keys):
        rec = asset["occupations"].get(soc, {}).get(item)
        if rec is None or rec.get("unit") != "O*NET importance (1-5)":
            continue
        rec["direction"] = "rising" if p[k] >= cut else "stable"
        counts[rec["direction"]] += 1
    m = asset["model"]
    m["rising_model"] = {"name": report["model"], "trained": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         **report["test"], "val_within_update_auc": report["val_within_update_auc"]}
    m["rising_flag"] = report["flag"]
    m.setdefault("direction_counts", {})["rising"] = counts["rising"]
    OUTLOOK.write_text(json.dumps(asset, separators=(",", ":")), encoding="utf-8")
    print(f"{counts['rising']} rising skill flags -> {OUTLOOK}")


if __name__ == "__main__":
    main()
