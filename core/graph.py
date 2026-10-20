"""Multi-agent LangGraph.

    supervisor --unsupported/simple--> simple_lookup -> END
        |complex (fan-out)
        +--> profiler ---------+
        +--> knowledge_search -+--> gap_analysis (both scenarios) --+--> market_analyst (forecast) --+
                                                                    +--> pathway (+ learning, MCP) ---+--> coach -> reviewer -> END

Agents: Profiler, Knowledge (FastMCP), Gap Analyst, Market Analyst (STF-KAN), Pathway, Coach
(optional LLM), Reviewer (deterministic revision, <=2 repairs). Approval is NOT a node: it is a
human action in governance/. HR teams run one graph per employee in parallel (run_team).
"""
import logging
import operator
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any, TypedDict

from agents import coach, gap_analyst, knowledge, pathway, profiler
from core.router import route_with_reason
from core.state import Request, ValidationIssue
from core.usage import record
from validation.forecast_checks import check_forecast
from validation.revision import MAX_REVISIONS, revise

log = logging.getLogger(__name__)


class State(TypedDict, total=False):
    request: Request
    route: str
    route_reason: str
    answer: str
    levels: dict
    role_skills: dict
    skill_flags: dict
    evidence: list
    trend_evidence: list
    learning_evidence: list
    retrieval: dict
    skill_gaps: list
    scenario_comparison: list
    forecast: dict | None
    draft_pathway: Any
    narrative: str
    narrative_mode: str
    validation_issues: Annotated[list, operator.add]  # parallel agents append
    revision_count: int
    status: str
    usage: Annotated[list, operator.add]


def _timed(name, fn):
    def node(s: State) -> State:
        t = time.perf_counter()
        try:
            out = fn(s)
        except Exception as e:  # one failing agent must not crash the run; surface it
            log.exception("agent %s failed", name)
            out = {"validation_issues": [ValidationIssue(code="agent_error", severity="error", field=name,
                                                         message=f"{name} failed: {type(e).__name__}")]}
        extra = out.pop("_usage", [])
        out["usage"] = [record(name, 1000 * (time.perf_counter() - t))] + [u for u in extra if u]
        return out
    return node


def n_supervisor(s):
    route, why = route_with_reason(s["request"].query)
    return {"route": route, "route_reason": why}


def n_simple(s):
    if s["route"] == "unsupported":
        return {"answer": "This assistant only covers workforce skills, roles and reskilling.", "status": "rejected"}
    r = s["request"]
    skills, ev, _ = knowledge.search_role_skills(r.target_role)
    top = ", ".join(f"{k} ({v}%)" for k, v in list(skills.items())[:5])
    ans = f"Most-mentioned skills in 2023 {r.target_role} job ads: {top}." if top else "No local data for that role."
    return {"answer": ans, "evidence": ev[:5], "status": "answered"}


def n_profiler(s):
    levels, issues = profiler.profile_skills(s["request"].profile, knowledge.known_skills())
    return {"levels": levels, "validation_issues": issues}


def n_knowledge(s):
    r = s["request"]
    skills, ev, meta = knowledge.search_role_skills(r.target_role)
    trends, mode = knowledge.labor_trends(r.target_role, r.scenario)
    meta["retrieval_mode"] = mode
    issues = [] if skills else [ValidationIssue(code="no_evidence", severity="error", field="target_role",
                                                message=f"No dated evidence for role '{r.target_role}'.")]
    return {"role_skills": skills, "skill_flags": meta.get("flags", {}), "evidence": ev, "trend_evidence": trends,
            "retrieval": meta, "validation_issues": issues}


def n_gaps(s):
    r = s["request"]
    flags = s.get("skill_flags", {})
    eid = lambda k: flags.get(k, {}).get("evidence_ids") or [knowledge.evidence_id(r.target_role, k)]
    gaps = {sc: gap_analyst.analyze(s.get("levels", {}), s.get("role_skills", {}), sc, eid)
            for sc in ("assistive", "agentic")}
    other = {g.skill_id: g for g in gaps["agentic" if r.scenario == "assistive" else "assistive"]}
    cmp = [{"skill_id": g.skill_id, "current": g.current_level,
            "assistive_required": (g if r.scenario == "assistive" else other[g.skill_id]).required_level,
            "agentic_required": (g if r.scenario == "agentic" else other[g.skill_id]).required_level}
           for g in gaps[r.scenario]]
    return {"skill_gaps": gaps[r.scenario], "scenario_comparison": cmp}


def n_market(s):
    gaps = [g for g in s.get("skill_gaps", []) if g.gap > 0]
    if not gaps or "forecast" not in s["request"].query.lower():
        return {"forecast": None}
    return {"forecast": knowledge.call_tool("forecast_skill_demand",
                                            {"role_id": s["request"].target_role, "skill_id": gaps[0].skill_id})}


def n_pathway(s):
    r = s["request"]
    need = [g.skill_id for g in s.get("skill_gaps", []) if g.gap > 0][:8]
    learning = {k: knowledge.learning_resources(k, 1) for k in need}
    p = pathway.build(s.get("skill_gaps", []), r.profile.weekly_learning_hours, r.target_role, r.scenario, learning)
    return {"draft_pathway": p, "learning_evidence": [e for v in learning.values() for e in v]}


def _all_evidence(s):
    seen, out = set(), []
    for e in s.get("evidence", []) + s.get("trend_evidence", []) + s.get("learning_evidence", []):
        if e.id not in seen:
            seen.add(e.id)
            out.append(e)
    return out


def n_coach(s):
    r = s["request"]
    text, usage, mode = coach.explain(r.audience, r.employee_id or "you", r.target_role, r.scenario,
                                      s.get("skill_gaps", []), s["draft_pathway"], _all_evidence(s),
                                      s.get("skill_flags", {}))
    return {"narrative": text, "narrative_mode": mode, "_usage": [usage]}


def n_reviewer(s):
    ev = _all_evidence(s)
    known = {e.id for e in ev}
    p, issues, n = revise(s["draft_pathway"], s.get("skill_gaps", []), known, s["request"].profile.weekly_learning_hours)
    text = s.get("narrative", "")
    bad = [c for c in coach.citations(text) if c not in known]
    if bad:  # targeted repair of the narrative field only; counts toward the same budget
        if n < MAX_REVISIONS:
            text, n = coach.strip_unknown(text, known), n + 1
            issues.append(ValidationIssue(code="narrative_citation_repaired", severity="warning", field="narrative",
                                          message=f"removed unverifiable citations: {bad[:3]}"))
        else:
            issues.append(ValidationIssue(code="narrative_citation", severity="error", field="narrative",
                                          message=f"unverifiable citations: {bad[:3]}"))
    f = s.get("forecast")
    f_issues = check_forecast(f)
    if f_issues:  # a bad forecast is withheld, never repaired into a pass
        f = {"data_quality": "unavailable", "warnings": [i.message for i in f_issues]}
    issues += f_issues
    blocked = any(i.severity == "error" for i in issues + s.get("validation_issues", []))
    status = "flagged" if blocked else p.status
    return {"draft_pathway": p.model_copy(update={"status": status}), "forecast": f, "narrative": text,
            "evidence": ev, "validation_issues": issues, "revision_count": n, "status": status}


PIPELINE = {"profiler": n_profiler, "knowledge_search": n_knowledge, "gap_analysis": n_gaps,
            "market_analyst": n_market, "pathway": n_pathway, "coach": n_coach, "reviewer": n_reviewer}


def build_graph():
    from langgraph.graph import END, START, StateGraph
    g = StateGraph(State)
    g.add_node("supervisor", _timed("supervisor", n_supervisor))
    g.add_node("simple_lookup", _timed("simple_lookup", n_simple))
    for name, fn in PIPELINE.items():
        g.add_node(name, _timed(name, fn))
    g.add_edge(START, "supervisor")
    g.add_conditional_edges("supervisor", lambda s: ["profiler", "knowledge_search"] if s["route"] == "complex"
                            else ["simple_lookup"], ["profiler", "knowledge_search", "simple_lookup"])
    g.add_edge("simple_lookup", END)
    g.add_edge(["profiler", "knowledge_search"], "gap_analysis")  # join
    g.add_edge("gap_analysis", "market_analyst")
    g.add_edge("gap_analysis", "pathway")
    g.add_edge(["market_analyst", "pathway"], "coach")  # join
    g.add_edge("coach", "reviewer")
    g.add_edge("reviewer", END)
    return g.compile()


_GRAPH = None


def run(request: Request) -> State:
    global _GRAPH
    _GRAPH = _GRAPH or build_graph()
    return _GRAPH.invoke({"request": request})


def run_team(requests: list[Request], max_workers: int = 8) -> dict:
    """HR view: one multi-agent run per employee (parallel) + aggregated team needs (no ranking of people)."""
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = dict(zip([r.employee_id or r.request_id for r in requests], pool.map(run, requests)))
    agg: dict[str, dict] = {}
    for res in results.values():
        for g in res.get("skill_gaps", []):
            if g.gap > 0:
                a = agg.setdefault(g.skill_id, {"skill_id": g.skill_id, "employees_with_gap": 0, "total_gap_levels": 0,
                                                "est_training_hours": 0.0})
                a["employees_with_gap"] += 1
                a["total_gap_levels"] += g.gap
                a["est_training_hours"] += g.gap * pathway.HOURS_PER_LEVEL
    team = sorted(agg.values(), key=lambda a: (-a["employees_with_gap"], -a["total_gap_levels"]))
    return {"employees": results, "team_skill_needs": team,
            "flagged": [k for k, v in results.items() if v.get("status") == "flagged"]}


def stream(request: Request):
    """Yield ("update", node, partial_state) as each agent finishes, then ("final", None, state)."""
    global _GRAPH
    _GRAPH = _GRAPH or build_graph()
    final = None
    for mode, chunk in _GRAPH.stream({"request": request}, stream_mode=["updates", "values"]):
        if mode == "updates":
            for node, update in chunk.items():
                yield "update", node, update or {}
        else:
            final = chunk
    yield "final", None, final
