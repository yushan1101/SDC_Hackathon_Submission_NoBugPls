"""Runtime STF-KAN serving on CPU (blueprint section 7): gated, manifest-checked, same rule as the offline export.

The Market Analyst calls `outlook_for(pairs)` through the MCP `skill_outlook` tool. Gate (any failure -> Unavailable
with a reason, never invented numbers): artifact_manifest.json present, checkpoint and input history match the
manifest's SHA-256, checkpoint series set matches the history. scripts/export_outlook.py uses the same
`latest_batch` / `predict` / `record` functions, so live output equals the exported asset (tests/test_serving.py).
"""
import hashlib
import json
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

SRC = Path(__file__).resolve().parents[1]


def paths() -> tuple[Path, Path, Path]:
    """(checkpoint, input history, manifest) from settings: OUTLOOK_ARTIFACT_DIR, OUTLOOK_HISTORY_PATH."""
    from config.settings import get_settings
    s = get_settings()
    art = Path(s.outlook_artifact_dir)
    return art / "stf_kan_best.pt", Path(s.outlook_history_path), art / "artifact_manifest.json"
WARNING = "Historical O*NET release-history model; a ranking signal for the next releases, not a verified current-demand forecast."


class Unavailable(Exception):
    pass


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(ckpt: Path, data: Path) -> dict:
    """Offline, after training/export. Fields required by blueprint section 7."""
    tm = json.loads((ckpt.parent / "training_manifest.json").read_text())
    dr = ckpt.parent / "direction_report.json"
    er = ckpt.parent / "ensemble_report.json"
    metrics = json.loads(er.read_text()).get("metrics", {}) if er.exists() else {}
    m = {"model_version": f"stf-kan-onet-{tm['created_utc'][:10]}-{sha256(ckpt)[:8]}",
         "trained_at": tm["created_utc"], "train_start": tm["splits"]["train"][0], "train_end": tm["splits"]["train"][1],
         "data_end": tm["splits"]["test"][1], "dataset_source": "O*NET 25.0-31.0 release history (CC BY 4.0)",
         "dataset_checksum": sha256(data), "checkpoint_sha256": sha256(ckpt), "forecast_horizon": "next O*NET releases",
         "feature_schema_version": tm.get("checkpoint_variant"), "embedding_model": tm.get("semantic_source"),
         "validation_metrics": {"direction": json.loads(dr.read_text()) if dr.exists() else None,
                                "ensemble_test_global_mae": {k: v.get("test", {}).get("global_mae") for k, v in metrics.items()}},
         "demo_only": False, "written_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (ckpt.parent / "artifact_manifest.json").write_text(json.dumps(m, indent=1))
    return m


def rule_from(ckpt: Path, ck: dict) -> dict:
    drep_path = ckpt.parent / "direction_report.json"
    drep = json.loads(drep_path.read_text()) if drep_path.exists() else {"enabled": {}}
    enabled = drep.get("enabled", {})
    return {"bands": ck["interval_q80_pp"], "enabled": enabled, "drep": drep,
            "rise_cut": drep.get("skill_rising_cut", {}).get("threshold_pp") if enabled.get("skill:rising") else None}


def latest_batch(s, ck: dict, rows: np.ndarray):
    """Model inputs for the last `window` releases of the given series rows."""
    W = ck["window"]
    x = s.values[rows, -W:]
    mask = ~np.isnan(x)
    fill = lambda v: np.where(np.isnan(v), np.nanmean(np.where(mask, v, np.nan), axis=1, keepdims=True), v)
    xf = np.nan_to_num(fill(x))
    xg = np.where(np.isnan(s.companion[rows, -W:]), xf, s.companion[rows, -W:])
    ri = {r: i for i, r in enumerate(s.roles)}
    si = {k: i for i, k in enumerate(s.skills)}
    b = {"x": xf, "mask": mask.astype(float), "xg": xg, "logn": np.zeros_like(xf),
         "role": np.array([ri[s.keys[i][0]] for i in rows]), "skill": np.array([si[s.keys[i][1]] for i in rows]),
         "series": np.asarray(rows)}
    return b, x, mask


def predict(model, ck: dict, b: dict) -> np.ndarray:
    from forecasting.inference import predict_batch
    return np.concatenate([predict_batch(model, ck, {k: v[i:i + 8192] for k, v in b.items()})
                           for i in range(0, len(b["x"]), 8192)])


def record(kind: str, cur: float, pred: np.ndarray, rule: dict) -> dict:
    """Direction rule (conservative): only directions STF-KAN won on VALIDATION can be flagged."""
    fc, enabled, bands = np.clip(pred, 0, 100), rule["enabled"], rule["bands"]
    if kind == "skill":
        to_im = lambda v: 1 + float(v) / 100 * 4
        band = float(np.asarray(bands.get("skill", bands.get(next(iter(bands)))) if isinstance(bands, dict) else bands)[-1]) / 100 * 4
        delta, thr = to_im(fc[-1]) - to_im(cur), max(0.05, band)
        direction = "rising" if delta > thr else "falling" if delta < -thr else "stable"
        if rule["rise_cut"] is not None and float(fc[-1]) - cur >= rule["rise_cut"]:  # validated top-q% cut-off
            direction = "rising"
        if not enabled.get(f"skill:{direction}", direction == "stable"):
            direction = "stable"
        return {"current": round(to_im(cur), 3), "forecast": [round(to_im(v), 3) for v in fc],
                "band": round(band, 3), "direction": direction, "unit": "O*NET importance (1-5)"}
    direction = "rising" if cur < 50 <= fc[-1] else "falling" if cur >= 50 > fc[-1] else "stable"
    if not enabled.get(f"tool:{direction}", direction == "stable"):
        direction = "stable"
    return {"current": round(cur / 100, 3), "forecast": [round(float(v) / 100, 3) for v in fc],
            "band": None, "direction": direction, "unit": "probability of Hot Technology flag"}


@lru_cache(maxsize=1)
def _runtime(ckpt: str, history: str, manifest: str):
    ckpt, history, manifest = Path(ckpt), Path(history), Path(manifest)
    for p, what in ((manifest, "artifact manifest"), (ckpt, "trained checkpoint"), (history, "input history")):
        if not p.exists():
            raise Unavailable(f"{what} not installed ({p.name})")
    man = json.loads(manifest.read_text())
    if sha256(ckpt) != man["checkpoint_sha256"]:
        raise Unavailable("checkpoint does not match the manifest checksum")
    if sha256(history) != man["dataset_checksum"]:
        raise Unavailable("input history does not match the manifest checksum")
    from forecasting.datasets import load_onet_series
    from forecasting.inference import load_model
    model, ck = load_model(ckpt)  # map_location=cpu
    s = load_onet_series(str(history))
    if ck.get("dataset") != "onet" or [tuple(k) for k in ck["keys"]] != s.keys:
        raise Unavailable("checkpoint series set differs from the input history")
    return model, ck, s, {k: i for i, k in enumerate(s.keys)}, rule_from(ckpt, ck), man


def outlook_for(pairs: dict, ckpt: Path | None = None, history: Path | None = None,
                manifest: Path | None = None) -> tuple[dict, dict]:
    """pairs = {label: (soc, item, kind)} -> ({label: record}, meta). Raises Unavailable(reason)."""
    t = time.perf_counter()
    if ckpt is None:
        ckpt, history, manifest = paths()
    model, ck, s, index, rule, man = _runtime(str(ckpt), str(history), str(manifest))
    keep = {lab: index[k] for lab, k in pairs.items() if tuple(k) in index}
    out = {}
    if keep:
        rows = np.array(list(keep.values()))
        b, x, mask = latest_batch(s, ck, rows)
        pred = predict(model, ck, b)
        for j, lab in enumerate(keep):
            if mask[j, -1]:
                out[lab] = record(pairs[lab][2], float(x[j, -1]), pred[j], rule)
    meta = {"status": "available" if out else "unavailable", "mode": "live_cpu_inference",
            "model_version": man["model_version"], "trained_at": man["trained_at"], "training_data_end": man["data_end"], "device": "cpu",
            "latency_ms": round(1000 * (time.perf_counter() - t), 1), "n_series": len(out),
            "data_relevance_warning": WARNING, "reason": None if out else "no forecast series mapped to this occupation"}
    return out, meta
