"""Deterministic score aggregation for the interview rubric."""
from collections import defaultdict


WEIGHTS = {
    "knowledge": 30,
    "relevance": 25,
    "problem_solving": 20,
    "communication": 15,
    "practical_evidence": 10,
}


def aggregate(evaluations: list[dict], profile_coverage: float, required_skills: list[dict]) -> dict:
    """Aggregate answer-level 0-4 ratings without asking a model to do arithmetic."""
    totals = defaultdict(float)
    counts = defaultdict(int)
    rationale = defaultdict(list)
    demonstrated = defaultdict(list)
    for evaluation in evaluations:
        scores = evaluation.get("scores", {})
        reasons = evaluation.get("rationale", {})
        for key in WEIGHTS:
            if scores.get(key) is None:
                continue
            totals[key] += float(scores[key])
            counts[key] += 1
            if reasons.get(key):
                rationale[key].append(str(reasons[key]))
        for item in evaluation.get("demonstrated_skills", []):
            name = str(item.get("name", ""))
            if name:
                demonstrated[name].append(item)

    dimensions = {}
    scored_weight = 0
    weighted_total = 0.0
    for key, weight in WEIGHTS.items():
        score = round(totals[key] / counts[key] * 25) if counts[key] else None
        dimensions[key] = {
            "score": score,
            "weight": weight,
            "reason": " ".join(rationale[key][-2:]) if rationale[key] else "Not enough evidence was collected for this criterion.",
            "evidence_count": counts[key],
        }
        if score is not None:
            scored_weight += weight
            weighted_total += score * weight
    performance = round(weighted_total / scored_weight) if scored_weight else 0

    competency_results = []
    for requirement in required_skills:
        answers = demonstrated.get(requirement["name"], [])
        avg = round(sum(float(a.get("score", 0)) for a in answers) / len(answers) * 25) if answers else None
        competency_results.append({
            "name": requirement["name"], "importance": requirement["importance"],
            "required_level": requirement["required_level"], "profile_level": requirement["profile_level"],
            "interview_score": avg,
            "evidence": [str(a.get("evidence", "")) for a in answers if a.get("evidence")][:3],
        })

    # A question not asked about a skill is "not assessed", not evidence of inability.
    role_scores = [x for x in competency_results if x["interview_score"] is not None]
    demonstrated_fit = round(sum(x["interview_score"] * x["importance"] for x in role_scores) /
                             sum(x["importance"] for x in role_scores)) if role_scores else performance
    readiness = round(performance * 0.65 + profile_coverage * 0.35)
    competitiveness = round(demonstrated_fit * 0.70 + profile_coverage * 0.30)

    ranked = sorted(competency_results, key=lambda x: (
        x["interview_score"] if x["interview_score"] is not None else 101,
        x["profile_level"] / max(x["required_level"], 1),
    ))
    gaps = [x for x in ranked if x["interview_score"] is None or x["interview_score"] < 65 or x["profile_level"] < x["required_level"]]
    strengths = [x for x in sorted(role_scores, key=lambda x: -x["interview_score"]) if x["interview_score"] >= 70][:4]
    recommendations = []
    for item in gaps[:5]:
        if item["interview_score"] is None:
            focus = "Practice explaining your experience with"
        elif item["interview_score"] < 50:
            focus = "Review the fundamentals and practice applying"
        else:
            focus = "Build a concrete example that demonstrates"
        recommendations.append({
            "skill": item["name"],
            "reason": ("This competency was not directly assessed in your answers." if item["interview_score"] is None
                       else f"Interview evidence scored {item['interview_score']}%; your profile level is {item['profile_level']}/5 against {item['required_level']}/5 required."),
            "exercise": f"{focus} {item['name']} in a short, role-specific example. Structure it as situation, action, and result.",
        })
    return {
        "rubric_version": "1.0",
        "weights": WEIGHTS,
        "performance": performance,
        "readiness": readiness,
        "competitiveness": competitiveness,
        "profile_coverage": round(profile_coverage),
        "demonstrated_fit": demonstrated_fit,
        "evidence_coverage": round(scored_weight / 100 * 100),
        "dimensions": dimensions,
        "competencies": competency_results,
        "strengths": strengths,
        "gaps": gaps[:6],
        "recommendations": recommendations,
        "disclaimer": "Simulated coaching assessment, not a verified probability of receiving a job offer. Outcomes depend on employer requirements, other applicants, experience, interviewers, and market conditions.",
    }
