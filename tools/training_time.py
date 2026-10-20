"""Simple deterministic workload feasibility helper."""
from math import ceil

def weeks_required(total_hours: float, hours_per_week: float) -> int:
    if total_hours < 0 or hours_per_week <= 0:
        raise ValueError("Hours must be valid and weekly hours positive")
    return ceil(total_hours / hours_per_week)
