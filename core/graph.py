"""Multi-agent LangGraph for ANY O*NET occupation.

    supervisor --unsupported/simple--> simple_lookup -> END
        |complex (fan-out)
        +--> profiler ----------+
        +--> knowledge_search --+--> gap_analysis (both scenarios, outlook-weighted) --> pathway (+ learning, MCP)
        +--> market_analyst ----+                                                          --> coach -> reviewer -> END

Agents: Profiler, Knowledge (FastMCP, O*NET 31.0), Market Analyst (STF-KAN skill-outlook asset, trained
offline on the O*NET release history), Gap Analyst, Pathway, Coach (optional LLM), Reviewer (<=2 repairs).
No raw training data (2023 job ads, O*NET history) is read here: the Market Analyst only reads the model's
exported outlook. Approval is NOT a node: it is a human action in governance/.
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
from validation.revision import MAX_REVISIONS, revise

log = logging.getLogger(__name__)
TREND_WEIGHT = 0.25  # ranking only: rising skills x1.25, falling x0.75; required levels stay O*NET


class State(TypedDict, total=False):
    request: Request
    occupation: dict
    route: str
    route_reason: str
    answer: str
    levels: dict
    requirements: dict
    evidence: list
    trend_evidence: list
    learning_evidence: list
    outlook: dict
    outlook_evidence: list
    retrieval: dict
    skill_gaps: list
    scenario_comparison: list
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


def _soc(s):
    return knowledge.resolve_occupation(s["request"].target_role)


def n_supervisor(s):
    route, why = route_with_reason(s["request"].query)
    soc = _soc(s)
    occ = knowledge.occupation(soc) if soc else None
    return {"route": route, "route_reason": why, "occupation": {"soc": soc, "title": occ["title"]} if occ else {}}


def n_simple(s):
    if s["route"] == "unsupported":
        return {"answer": "This assistant only covers workforce skills, roles and reskilling.", "status": "rejected"}
    reqs, ev, meta = knowledge.role_requirements(s["request"].target_role)
    skills = [k for k, r in reqs.items() if r["kind"] == "skill"][:5]
    ans = (f"Most important skills for {meta['title']} (O*NET 31.0): {', '.join(skills)}." if skills
           else "That occupation is not in O*NET 31.0's rated occupations.")
    return {"answer": ans, "evidence": [e for e in ev if e.id.split(":")[-1] in skills], "status": "answered"}


def n_profiler(s):
    soc = _soc(s)
    tools = [t["name"] for t in (knowledge.occupation(soc) or {}).get("tech", [])] if soc else []
    levels, issues = profiler.profile_skills(s["request"].profile, set(knowledge.known_skills()), tools)
    return {"levels": levels, "validation_issues": issues}


def n_knowledge(s):
    r = s["request"]
    reqs, ev, meta = knowledge.role_requirements(r.target_role)
    trends, mode = knowledge.labor_trends(r.target_role, r.scenario) if reqs else ([], "offline")
    meta["retrieval_mode"] = mode
    issues = [] if reqs else [ValidationIssue(code="no_evidence", severity="error", field="target_role",
                                              message=f"'{r.target_role}' is not an O*NET 31.0 rated occupation.")]
    return {"requirements": reqs, "evidence": ev, "trend_evidence": trends, "retrieval": meta, "validation_issues": issues}


def n_market(s):
    """STF-KAN outlook for this occupation, read from the exported model asset via MCP (no raw data)."""
    soc = _soc(s)
    if not soc:
        return {"outlook": {}, "outlook_evidence": []}
    r = knowledge.call_tool("skill_outlook", {"role_id": soc})
    return {"outlook": r.get("outlook", {}), "outlook_evidence": knowledge.to_evidence(r.get("evidence", []))}


def n_gaps(s):
    r = s["request"]
    reqs, outlook = s.get("requirements", {}), s.get("outlook", {})
    gaps = {sc: gap_analyst.analyze(s.get("levels", {}), reqs, sc) for sc in ("assistive", "agentic")}
    trend = {"rising": 1, "falling": -1}
    weight = lambda g: g.gap * (g.importance or 3.0) * (1 + TREND_WEIGHT * trend.get(outlook.get(g.skill_id, {}).get("direction"), 0))
    for sc in gaps:
        gaps[sc].sort(key=lambda g: (-weight(g), g.kind != "skill", g.skill_id))
    other = {g.skill_id: g for g in gaps["agentic" if r.scenario == "assistive" else "assistive"]}
    cmp = [{"skill_id": g.skill_id, "current": g.current_level,
            "assistive_required": (g if r.scenario == "assistive" else other[g.skill_id]).required_level,
            "agentic_required": (g if r.scenario == "agentic" else other[g.skill_id]).required_level,
            "outlook": outlook.get(g.skill_id, {}).get("direction")}
           for g in gaps[r.scenario]]
    return {"skill_gaps": gaps[r.scenario], "scenario_comparison": cmp}


def n_pathway(s):
    r = s["request"]
    need = [g.skill_id for g in s.get("skill_gaps", []) if g.gap > 0][:8]
    learning = {k: knowledge.learning_resources(k, 1) for k in need}
    p = pathway.build(s.get("skill_gaps", []), r.profile.weekly_learning_hours,
                      s.get("occupation", {}).get("title") or r.target_role, r.scenario, learning)
    return {"draft_pathway": p, "learning_evidence": [e for v in learning.values() for e in v]}


def _all_evidence(s):
    seen, out = set(), []
    for e in (s.get("evidence", []) + s.get("trend_evidence", []) + s.get("learning_evidence", [])
              + s.get("outlook_evidence", [])):
        if e.id not in seen:
            seen.add(e.id)
            out.append(e)
    return out


def n_coach(s):
    r = s["request"]
    title = s.get("occupation", {}).get("title") or r.target_role
    text, usage, mode = coach.explain(r.audience, r.employee_id or "you", title, r.scenario,
                                      s.get("skill_gaps", []), s["draft_pathway"], _all_evidence(s), s.get("outlook", {}))
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
    blocked = any(i.severity == "error" for i in issues + s.get("validation_issues", []))
    status = "flagged" if blocked else p.status
    return {"draft_pathway": p.model_copy(update={"status": status}), "narrative": text,
            "evidence": ev, "validation_issues": issues, "revision_count": n, "status": status}


PIPELINE = {"profiler": n_profiler, "knowledge_search": n_knowledge, "market_analyst": n_market,
            "gap_analysis": n_gaps, "pathway": n_pathway, "coach": n_coach, "reviewer": n_reviewer}


def build_graph():
    from langgraph.graph import END, START, StateGraph
    g = StateGraph(State)
    g.add_node("supervisor", _timed("supervisor", n_supervisor))
    g.add_node("simple_lookup", _timed("simple_lookup", n_simple))
    for name, fn in PIPELINE.items():
        g.add_node(name, _timed(name, fn))
    g.add_edge(START, "supervisor")
    fan = ["profiler", "knowledge_search", "market_analyst"]
    g.add_conditional_edges("supervisor", lambda s: fan if s["route"] == "complex" else ["simple_lookup"],
                            fan + ["simple_lookup"])
    g.add_edge("simple_lookup", END)
    g.add_edge(fan, "gap_analysis")  # join
    g.add_edge("gap_analysis", "pathway")
    g.add_edge("pathway", "coach")
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
