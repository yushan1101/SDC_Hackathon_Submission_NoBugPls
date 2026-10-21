"""Profiler: align what people type, pick in the quiz or show in a resume to the target occupation's ESCO skills.

Exact names count directly; otherwise each requirement is credited with the level of the person's most similar
skill (MiniLM cosine, agents/skillmap.py). Every credited requirement keeps the person's own wording as its source.
"""
from core.state import Profile, ValidationIssue

# everyday wording -> phrasing closer to ESCO labels (helps the semantic match on very short inputs)
SKILL_ALIASES = {  # values are real ESCO labels where one exists
    "public speaking": "Present arguments persuasively",
    "presenting": "Present arguments persuasively", "listening": "Listen actively", "active listening": "Listen actively",
    "critical thinking": "Address problems critically", "problem solving": "Address problems critically",
    "analytical thinking": "Think analytically", "analysis": "Think analytically", "decision making": "Make time-critical decisions",
    "leadership": "Lead a team", "team leadership": "Lead a team", "empathy": "Show empathy",
    "customer service": "Customer service", "coding": "Computer programming", "programming": "Computer programming",
    "excel": "Use spreadsheets", "microsoft excel": "Use spreadsheets", "spreadsheets": "Use spreadsheets",
    "microsoft office": "Use microsoft office", "ms office": "Use microsoft office", "sql": "SQL",
    "python": "Python (computer programming)", "java": "Java (computer programming)",
    "teaching": "teach others", "training others": "train employees", "teamwork": "work in a team",
    "time management": "manage time", "people management": "Manage staff", "budgeting": "Manage budgets",
    "repair": "repair equipment", "maintenance": "maintain equipment", "quality control": "Perform quality control",
    "negotiation": "Negotiate buying conditions", "sales": "Sell products", "cash handling": "Handle cash flow",
}


def expand(name: str) -> str:
    n = " ".join(name.strip().split())
    return SKILL_ALIASES.get(n.lower(), n)


def profile_skills(profile: Profile, targets: list[str]) -> tuple[dict[str, int], dict[str, str], list[ValidationIssue]]:
    """-> ({requirement: credited level}, {requirement: the person's skill it came from}, warnings)."""
    from agents.skillmap import align
    mine: dict[str, int] = {}
    for s in profile.skills:
        k = expand(s.name)
        mine[k] = max(mine.get(k, 0), s.level)
    hit = align(mine, targets)
    used = {src for _, src, _ in hit.values()}
    unmatched = [k for k, v in mine.items() if v > 0 and k not in used]
    issues = [ValidationIssue(code="unknown_skill", severity="warning", field="profile.skills",  # one note, not one per skill
              message=f"{len(unmatched)} of your skills aren't among this job's ESCO requirements, so they're kept but not scored: "
                      + ", ".join(unmatched[:6]) + (f" and {len(unmatched) - 6} more." if len(unmatched) > 6 else "."))] if unmatched else []
    return {t: lv for t, (lv, _, _) in hit.items()}, {t: src for t, (_, src, _) in hit.items()}, issues
