"""Resume screening: a LangGraph of AI agents per application, plus a ranking agent across an opening.

    parse_resume (file -> Markdown -> redacted) -> extract_skills (O*NET skills/tools + verbatim evidence)
      -> assess_fit (occupation requirements, resume text similarity, daily trend board)
      -> judge_criteria (each HR threshold pass/fail with evidence)
rank_candidates(): recommends the top-k that pass every hard criterion, by fit, with reasons. Humans decide.
"""
import logging
import time
from typing import Any, TypedDict

from agents import resume
from agents.knowledge import occupation
from agents.matcher import fit_for
from core.usage import record

log = logging.getLogger(__name__)


class ScreenState(TypedDict, total=False):
    filename: str
    data: bytes
    md: str
    redacted: str
    extraction: dict
    soc: str
    criteria: dict
    board: Any
    fit: dict
    checks: list
    passed: bool
    usage: list
    error: str


def _timed(name, fn):
    def node(s):
        t = time.perf_counter()
        out = fn(s)
        out["usage"] = s.get("usage", []) + [record(name, 1000 * (time.perf_counter() - t))]
        return out
    return node


def n_parse(s):
    md = resume.to_markdown(s["filename"], s["data"])
    return {"md": md, "redacted": resume.redact(md)}


def n_extract(s):
    x = resume.extract(s["md"])
    x["skills"] = resume.verify(s["md"], x["skills"])  # only claims with verbatim evidence survive
    return {"extraction": x}


def n_fit(s):
    levels = {k["name"]: k["level"] for k in s["extraction"]["skills"]}
    return {"fit": fit_for(levels, s["soc"], text=s["redacted"], board=s.get("board")) or {}}


def n_judge(s):
    c, x, f = s.get("criteria") or {}, s["extraction"], s["fit"]
    levels = {k["name"]: k for k in x["skills"]}
    checks = []
    for skill, need in c.get("min_levels", {}).items():
        have = levels.get(skill)
        checks.append({"criterion": f"{skill} >= {need}", "pass": bool(have and have["level"] >= need),
                       "found": have["level"] if have else 0, "evidence": (have or {}).get("evidence", [])[:1]})
    for tool in c.get("required_tools", []):
        have = levels.get(tool) or next((v for k, v in levels.items() if tool.lower() in k.lower() or k.lower() in tool.lower()), None)
        checks.append({"criterion": f"uses {tool}", "pass": bool(have), "evidence": (have or {}).get("evidence", [])[:1]})
    if c.get("min_years") is not None:
        yrs = x.get("years_experience")
        checks.append({"criterion": f">= {c['min_years']} years", "pass": bool(yrs and yrs >= c["min_years"]), "found": yrs})
    if c.get("min_fit") is not None:
        checks.append({"criterion": f"match >= {c['min_fit']:.0%}", "pass": f.get("fit", 0) >= c["min_fit"],
                       "found": round(f.get("fit", 0), 2)})
    return {"checks": checks, "passed": all(ch["pass"] for ch in checks)}


_G = None


def _graph():
    global _G
    if _G is None:
        from langgraph.graph import END, START, StateGraph
        g = StateGraph(ScreenState)
        for name, fn in (("parse_resume", n_parse), ("extract_skills", n_extract), ("assess_fit", n_fit),
                         ("judge_criteria", n_judge)):
            g.add_node(name, _timed(name, fn))
        g.add_edge(START, "parse_resume")
        g.add_edge("parse_resume", "extract_skills")
        g.add_edge("extract_skills", "assess_fit")
        g.add_edge("assess_fit", "judge_criteria")
        g.add_edge("judge_criteria", END)
        _G = g.compile()
    return _G


def screen(filename: str, data: bytes, soc: str, criteria: dict, board: dict | None = None) -> dict:
    """-> {md, redacted, analysis{skills, years, fit, checks, passed, usage}}. Raises ValueError on bad files."""
    s = _graph().invoke({"filename": filename, "data": data, "soc": soc, "criteria": criteria, "board": board})
    analysis = {"skills": s["extraction"]["skills"], "years_experience": s["extraction"]["years_experience"],
                "fit": s["fit"].get("fit", 0.0), "coverage": s["fit"].get("coverage"), "top_gaps": s["fit"].get("top_gaps", []),
                "checks": s["checks"], "passed": s["passed"], "usage": s["usage"],
                "occupation": (occupation(soc) or {}).get("title")}
    return {"md": s["md"], "redacted": s["redacted"], "analysis": analysis}


def _pct(x: float) -> str:
    return f"{int(x * 100 + 0.5)}%"  # half-up, same as the UI's Math.round


def rank_candidates(apps: list[dict], criteria: dict) -> tuple[list[str], dict[str, str]]:
    """Ranking agent: candidates passing every hard criterion, by fit; top_k (default 5). -> (ids, reasons)."""
    k = criteria.get("top_k") or 5
    eligible = sorted((a for a in apps if a["analysis"].get("passed")), key=lambda a: -a["fit"])
    chosen = eligible[:k]
    reasons = {}
    for i, a in enumerate(chosen, 1):
        an = a["analysis"]
        met = [c["criterion"] for c in an["checks"]]
        reasons[a["id"]] = (f"#{i}: match {_pct(a['fit'])} for {an.get('occupation')}; meets " +
                            (", ".join(met) if met else "the role requirements") +
                            (f"; main gaps {', '.join(an['top_gaps'][:2])}" if an.get("top_gaps") else ""))
    for a in apps:
        if a["id"] not in reasons:
            failed = [c["criterion"] for c in a["analysis"].get("checks", []) if not c["pass"]]
            reasons[a["id"]] = ("Not recommended: misses " + ", ".join(failed)) if failed else \
                f"Eligible but below the top {k} by match ({_pct(a['fit'])})."
    return [a["id"] for a in chosen], reasons
