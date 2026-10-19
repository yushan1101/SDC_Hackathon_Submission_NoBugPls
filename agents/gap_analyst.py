"""Deterministic gap matrix: required level from job-ad mention %, adjusted by a documented scenario assumption."""
from core.state import Gap

# ponytail: fixed thresholds, not learned. mention% of role postings -> required proficiency (0..5)
LEVEL_THRESHOLDS = [(50, 4), (30, 3), (15, 2), (5, 1)]
MIN_MENTION = 5.0

# SCENARIO ASSUMPTIONS (team-authored, not evidence):
#  assistive: AI helps people do today's work -> requirements as observed in 2023 ads.
#  agentic:   AI agents take over routine tool work -> +1 on skills used to build/orchestrate
#             automation, -1 on routine office/reporting tools.
AGENTIC_UP = {"python", "aws", "azure", "gcp", "spark", "airflow", "docker", "kubernetes", "pytorch",
              "tensorflow", "git", "databricks", "snowflake", "scikit-learn", "java", "scala", "linux"}
AGENTIC_DOWN = {"excel", "powerpoint", "word", "sas", "sap", "tableau", "power bi"}
SCENARIO_NOTES = {
    "assistive": "Required levels follow 2023 job-ad mention rates directly.",
    "agentic": "Assumption: agentic AI raises automation-building skills by +1 and lowers routine "
               "office/reporting tools by -1 relative to 2023 job-ad rates.",
}


def required_level(pct: float, skill: str, scenario: str) -> int:
    base = next((lvl for t, lvl in LEVEL_THRESHOLDS if pct >= t), 0)
    if scenario == "agentic":
        base += (skill in AGENTIC_UP) - (skill in AGENTIC_DOWN)
    return max(0, min(5, base))


def analyze(levels: dict[str, int], role_skills: dict[str, float], scenario: str, eid) -> list[Gap]:
    gaps = []
    for skill, pct in role_skills.items():
        if pct < MIN_MENTION:
            continue
        req, cur = required_level(pct, skill, scenario), levels.get(skill, 0)
        gaps.append(Gap(skill_id=skill, current_level=cur, required_level=req, gap=max(0, req - cur),
                        mention_percent=pct, rationale_source_ids=[ids] if isinstance(ids := eid(skill), str) else list(ids)))
    return sorted(gaps, key=lambda g: (-g.gap * g.mention_percent, g.skill_id))
