"""Deterministic gap matrix from O*NET requirements, adjusted by a documented scenario assumption.

Required levels come from O*NET 31.0 expert/incumbent ratings for the chosen occupation (any job):
skills with importance >= 3/5, level rescaled 0-7 -> 0-5; tools flagged Hot/In Demand at an assumed level 2.
"""
from core.state import Gap

# SCENARIO ASSUMPTIONS (team-authored, not evidence), applied to O*NET skill names:
#  assistive: AI helps people do today's work -> O*NET levels as rated.
#  agentic:   AI agents take over routine execution -> +1 on skills for directing, judging and checking
#             automated work; -1 on routine operation/monitoring skills that agents absorb.
AGENTIC_UP = {"Critical Thinking", "Complex Problem Solving", "Judgment and Decision Making", "Systems Analysis",
              "Systems Evaluation", "Active Learning", "Monitoring", "Programming", "Technology Design"}
AGENTIC_DOWN = {"Operation and Control", "Operations Monitoring", "Quality Control Analysis", "Equipment Selection"}
SCENARIO_NOTES = {
    "assistive": "Required levels follow O*NET 31.0 ratings for the occupation.",
    "agentic": "Assumption: agentic AI raises judgement and oversight skills (critical thinking, decision making, "
               "systems analysis…) by +1 and lowers routine operation/monitoring skills by -1 relative to O*NET.",
}


def required_level(base: int, skill: str, kind: str, scenario: str) -> int:
    if scenario == "agentic" and kind == "skill":
        base += (skill in AGENTIC_UP) - (skill in AGENTIC_DOWN)
    return max(0, min(5, base))


def analyze(levels: dict[str, int], reqs: dict[str, dict], scenario: str) -> list[Gap]:
    """reqs: {skill_id: {kind, required, importance, evidence_id}} from the Knowledge agent."""
    gaps = []
    for skill, r in reqs.items():
        req, cur = required_level(r["required"], skill, r["kind"], scenario), levels.get(skill, 0)
        gaps.append(Gap(skill_id=skill, kind=r["kind"], current_level=cur, required_level=req, gap=max(0, req - cur),
                        importance=r.get("importance"), rationale_source_ids=[r["evidence_id"]]))
    # biggest gaps on the most important skills first; tools after skills of equal weight
    return sorted(gaps, key=lambda g: (-g.gap * (g.importance or 3.0), g.kind != "skill", g.skill_id))
