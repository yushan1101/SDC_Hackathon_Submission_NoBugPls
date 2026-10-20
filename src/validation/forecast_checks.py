"""Deterministic forecast checks for the revision layer: horizon, bounds, interval order, as-of cutoff."""
from core.state import ValidationIssue


def check_forecast(f: dict | None, horizon: int = 4) -> list[ValidationIssue]:
    if not f or f.get("data_quality") == "unavailable":
        return []
    err = lambda code, msg: ValidationIssue(code=code, severity="error", field="forecast", message=msg)
    p = f.get("predicted_percent") or []
    issues = []
    if len(p) != horizon:
        issues.append(err("forecast_horizon", f"expected {horizon} weeks, got {len(p)}"))
    if any(not 0 <= v <= 100 for v in p):
        issues.append(err("forecast_bounds", "percent outside [0, 100]"))
    lo, hi = f.get("lower_percent"), f.get("upper_percent")
    if lo and hi and not all(a <= v <= b for a, v, b in zip(lo, p, hi)):
        issues.append(err("forecast_interval", "interval not ordered lower <= forecast <= upper"))
    if f.get("target_weeks") and f["target_weeks"][0] <= f["as_of_date"]:
        issues.append(err("forecast_cutoff", "target week not after as-of date"))
    if not f.get("is_historical_backtest"):
        issues.append(err("forecast_label", "must be labeled a historical backtest"))
    return issues
