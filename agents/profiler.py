"""Normalize what people type into O*NET skill names and the target occupation's tools (deterministic)."""
import re

from core.state import Profile, ValidationIssue

# everyday wording -> O*NET skill element (only unambiguous mappings)
SKILL_ALIASES = {
    "communication": "Speaking", "public speaking": "Speaking", "presenting": "Speaking",
    "listening": "Active Listening", "reading": "Reading Comprehension", "math": "Mathematics", "maths": "Mathematics",
    "problem solving": "Complex Problem Solving", "decision making": "Judgment and Decision Making",
    "judgement": "Judgment and Decision Making", "teaching": "Instructing", "training others": "Instructing",
    "customer service": "Service Orientation", "teamwork": "Coordination", "negotiating": "Negotiation",
    "sales": "Persuasion", "coding": "Programming", "programming": "Programming", "time management": "Time Management",
    "people management": "Management of Personnel Resources", "budgeting": "Management of Financial Resources",
    "repair": "Repairing", "maintenance": "Equipment Maintenance", "quality control": "Quality Control Analysis",
    "empathy": "Social Perceptiveness", "learning": "Active Learning", "systems thinking": "Systems Analysis",
}
TOOL_ALIASES = {"excel": "excel", "word": "word", "powerpoint": "powerpoint", "outlook": "outlook",
                "quickbooks": "quickbooks", "autocad": "autocad", "epic": "epic", "sap": "sap", "salesforce": "salesforce",
                "power bi": "power bi", "powerbi": "power bi", "sql": "sql", "python": "python", "tableau": "tableau"}


def normalize(name: str, known: set[str], tools: list[str]) -> str:
    """-> canonical id: an O*NET skill name, one of the occupation's tool names, or the cleaned input."""
    n = " ".join(name.strip().split())
    low = n.lower()
    by_lower = {k.lower(): k for k in known}
    if low in by_lower:
        return by_lower[low]
    if low in SKILL_ALIASES:
        return SKILL_ALIASES[low]
    key = TOOL_ALIASES.get(low, low)
    for t in tools:  # "excel" -> "Microsoft Excel" when this occupation lists it
        if re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", t.lower()):
            return t
    return n


def profile_skills(profile: Profile, known: set[str], tools: list[str] | None = None) -> tuple[dict[str, int], list[ValidationIssue]]:
    """-> {skill_id: level} (max level wins on duplicates) + warnings for inputs outside O*NET's vocabulary."""
    levels, issues = {}, []
    for s in profile.skills:
        sid = normalize(s.name, known, tools or [])
        levels[sid] = max(levels.get(sid, 0), s.level)
        if sid not in known and sid not in (tools or []):
            issues.append(ValidationIssue(code="unknown_skill", severity="warning", field="profile.skills",
                                          message=f"'{s.name}' is not an O*NET skill or a listed tool for this job; kept but not scored."))
    return levels, issues
