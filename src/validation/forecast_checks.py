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


def check_outlook(outlook: dict, fc: dict | None) -> list[ValidationIssue]:
    """Gate B for the STF-KAN skill outlook: labeled mode, values in range, known direction. Unavailable -> warning."""
    if not fc or fc.get("status") != "available":
        reason = (fc or {}).get("reason") or "no forecast returned"
        return [ValidationIssue(code="forecast_unavailable", severity="warning", field="outlook",
                                message=f"Skill outlook unavailable: {reason}. Gaps are ranked without it.")]
    issues = []
    if fc.get("mode") == "precomputed_asset":
        issues.append(ValidationIssue(code="forecast_precomputed", severity="warning", field="outlook",
                                      message=f"Skill outlook served from the exported model output ({fc.get('reason')})."))
    elif fc.get("mode") != "live_cpu_inference" or not fc.get("model_version"):
        issues.append(ValidationIssue(code="forecast_label", severity="error", field="outlook",
                                      message="forecast must state its mode and model version"))
    for skill, f in outlook.items():
        lo, hi = (1, 5) if f.get("unit", "").startswith(("O*NET importance", "forecast importance")) else (0, 1)
        vals = [f.get("current")] + list(f.get("forecast") or [])
        if f.get("direction") not in ("rising", "falling", "stable") or not f.get("forecast") \
                or any(v is None or not lo <= v <= hi for v in vals):
            issues.append(ValidationIssue(code="forecast_bounds", severity="error", field="outlook",
                                          message=f"invalid outlook for {skill}"))
    return issues
