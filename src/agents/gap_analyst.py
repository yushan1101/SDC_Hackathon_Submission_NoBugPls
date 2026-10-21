"""Deterministic gap matrix from ESCO requirements, adjusted by a documented scenario assumption.

Requirements are an ESCO occupation's essential and optional skills. Required level and importance are
predicted by a model trained offline on O*NET ratings (scripts/build_esco_requirements.py); the live agents
never read O*NET. Optional skills count at lower importance.
"""
from core.state import Gap

# SCENARIO ASSUMPTIONS (team-authored, not evidence):
#  assistive: AI helps people do today's work -> predicted levels as they are.
#  agentic:   AI agents take over routine execution -> +1 on skills for directing, judging and checking automated
#             work, -1 on routine operation/processing skills. Each ESCO skill's "agentic" tag (+1/0/-1) comes from
#             MiniLM similarity to written anchor phrases in scripts/build_esco_requirements.py (UP / DOWN).
SCENARIO_NOTES = {
    "assistive": "Required levels are the model's predictions for this ESCO occupation's essential and optional skills.",
    "agentic": "Assumption: agentic AI raises judgement and oversight skills (critical thinking, decisions, evaluating "
               "systems…) by +1 and lowers routine operation and processing skills by -1.",
}


def required_level(base: int, agentic_tag: int, kind: str, scenario: str) -> int:
    if scenario == "agentic" and kind == "skill":
        base += agentic_tag
    return max(0, min(5, base))


def analyze(levels: dict[str, int], reqs: dict[str, dict], scenario: str) -> list[Gap]:
    """levels: {requirement name: credited level} (already aligned by the Profiler).
    reqs: {skill_id: {kind, required, importance, evidence_id, agentic}} from the Knowledge agent."""
    gaps = []
    for skill, r in reqs.items():
        req = required_level(r["required"], r.get("agentic", 0), r["kind"], scenario)
        cur = levels.get(skill, 0)
        gaps.append(Gap(skill_id=skill, kind=r["kind"], current_level=cur, required_level=req, gap=max(0, req - cur),
                        importance=r.get("importance"), rationale_source_ids=[r["evidence_id"]]))
    # biggest gaps on the most important skills first; tools after skills of equal weight
    return sorted(gaps, key=lambda g: (-g.gap * (g.importance or 3.0), g.kind != "skill", g.skill_id))
