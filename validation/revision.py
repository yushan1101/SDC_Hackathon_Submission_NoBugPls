"""Deterministic validation + at most 2 targeted repairs, then `flagged` for a human."""
from core.state import Gap, Pathway, ValidationIssue

MAX_REVISIONS = 2


def validate(p: Pathway, gaps: list[Gap], evidence_ids: set[str], weekly_hours: float) -> list[ValidationIssue]:
    from agents.pathway import PHASES, phase_capacity
    issues = []
    gap_skills = {g.skill_id for g in gaps if g.gap > 0}
    cap = phase_capacity(weekly_hours)
    for i, a in enumerate(p.activities):
        f = f"activities[{i}]"
        if a.estimated_hours <= 0:
            issues.append(ValidationIssue(code="bad_hours", severity="error", field=f, message="non-positive hours"))
        if a.skill_id not in gap_skills:
            issues.append(ValidationIssue(code="no_gap", severity="error", field=f,
                                          message=f"{a.skill_id} has no documented gap"))
        if bad := [e for e in a.evidence_ids if e not in evidence_ids]:
            issues.append(ValidationIssue(code="unknown_evidence", severity="error", field=f,
                                          message=f"citation not retrieved: {bad}"))
    for ph in PHASES:
        h = sum(a.estimated_hours for a in p.activities if a.day_range == ph)
        if h > cap + 1e-6:
            issues.append(ValidationIssue(code="over_capacity", severity="error", field=f"phase {ph}",
                                          message=f"{h:.1f}h planned > {cap:.1f}h available"))
    order = [PHASES.index(a.day_range) for a in p.activities]
    if order != sorted(order):
        issues.append(ValidationIssue(code="phase_order", severity="warning", field="activities",
                                      message="activities not in 30/60/90 order"))
    if p.deferred_skills:
        issues.append(ValidationIssue(code="deferred", severity="warning", field="deferred_skills",
                                      message=f"Not fully covered by weekly hours: {', '.join(p.deferred_skills)}"))
    if p.status == "approved":
        issues.append(ValidationIssue(code="self_approved", severity="error", field="status",
                                      message="generated plan cannot be approved without a human"))
    return issues


def repair(p: Pathway, issues: list[ValidationIssue], evidence_ids: set[str], weekly_hours: float) -> Pathway:
    """Touch only the fields named by failing issues."""
    from agents.pathway import PHASES, phase_capacity
    codes = {i.code for i in issues if i.severity == "error"}
    acts = [a.model_copy() for a in p.activities]
    if "unknown_evidence" in codes:
        for a in acts:
            a.evidence_ids = [e for e in a.evidence_ids if e in evidence_ids]
    bad_idx = {int(i.field.split("[")[1][:-1]) for i in issues if i.code in ("bad_hours", "no_gap")}
    acts = [a for k, a in enumerate(acts) if k not in bad_idx]
    deferred = list(p.deferred_skills)
    if "over_capacity" in codes:  # drop lowest-priority (last) activities in an overfull phase
        cap = phase_capacity(weekly_hours)
        for ph in PHASES:
            while sum(a.estimated_hours for a in acts if a.day_range == ph) > cap + 1e-6:
                last = max(k for k, a in enumerate(acts) if a.day_range == ph)
                deferred.append(acts.pop(last).skill_id)
    acts.sort(key=lambda a: PHASES.index(a.day_range))
    status = "draft" if p.status == "approved" else p.status
    return p.model_copy(update={"activities": acts, "deferred_skills": sorted(set(deferred)), "status": status})


def revise(p: Pathway, gaps, evidence_ids, weekly_hours, repair_fn=repair):
    """-> (pathway with status draft|flagged, issues, revision_count)."""
    issues = validate(p, gaps, evidence_ids, weekly_hours)
    n = 0
    while any(i.severity == "error" for i in issues) and n < MAX_REVISIONS:
        p = repair_fn(p, issues, evidence_ids, weekly_hours)
        n += 1
        issues = validate(p, gaps, evidence_ids, weekly_hours)
    status = "flagged" if any(i.severity == "error" for i in issues) else "draft"
    return p.model_copy(update={"status": status}), issues, n
