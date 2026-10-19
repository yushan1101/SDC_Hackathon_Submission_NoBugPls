"""Structured 30/60/90 draft with SDG 4 (quality education) / SDG 8 (decent work) mapping."""
from core.state import Gap, Pathway, PathwayActivity

HOURS_PER_LEVEL = 15.0  # ponytail: flat effort assumption per proficiency step; replace with course catalog hours
PHASES = ("1-30", "31-60", "61-90")
DAYS_PER_PHASE = 30


def phase_capacity(weekly_hours: float) -> float:
    return round(weekly_hours * DAYS_PER_PHASE / 7, 1)


def build(gaps: list[Gap], weekly_hours: float, role: str, scenario: str, learning: dict | None = None) -> Pathway:
    """Greedy fill: highest-priority gaps first, split across phases, overflow deferred (never overbooked)."""
    cap = phase_capacity(weekly_hours)
    left = {p: cap for p in PHASES}
    acts, deferred = [], []
    for g in (g for g in gaps if g.gap > 0):
        need = g.gap * HOURS_PER_LEVEL
        for p in PHASES:
            if need <= 0:
                break
            h = round(min(need, left[p]), 1)
            if h <= 0:
                continue
            step = "Foundations course + guided exercises" if p == "1-30" else \
                   "Applied project on a real work task" if p == "31-60" else "Portfolio piece + peer/manager review"
            res = (learning or {}).get(g.skill_id, [])[:1]
            acts.append(PathwayActivity(day_range=p, skill_id=g.skill_id, estimated_hours=h,
                                        activity=f"{step}: {g.skill_id} (level {g.current_level} -> {g.required_level})"
                                                 + (f" using {res[0].title}" if res else ""),
                                        evidence_ids=list(g.rationale_source_ids) + [e.id for e in res],
                                        sdg_links=["SDG4", "SDG8"]))
            left[p] -= h
            need -= h
        if need > 0:
            deferred.append(g.skill_id)
    return Pathway(target_role=role, scenario=scenario, activities=acts, deferred_skills=deferred)
