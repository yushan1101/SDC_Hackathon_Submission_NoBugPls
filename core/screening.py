"""Resume screening: a LangGraph of AI agents per application, plus a ranking agent across an opening.

    parse_resume (file -> visible-only Markdown via the document guard -> redacted) -> extract_skills (ESCO skills + verbatim evidence)
      -> assess_fit (ESCO requirements, resume text similarity, daily trend board)
      -> judge_criteria (each HR threshold pass/fail with evidence) + integrity (injection / fraud signals)
rank_candidates(): recommends the top-k that pass every hard criterion, by fit, with reasons. Candidates whose
document is high-risk are held for a human, never auto-rejected. Humans decide.
"""
import logging
import re
import time
from typing import Any, TypedDict

from agents import resume
from agents.knowledge import occupation
from agents.matcher import fit_for
from agents.skillmap import align
from core.usage import record
from validation.document_guard import fraud_signals, risk

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
    seen: Any
    integrity: dict
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
    md, report = resume.convert(s["filename"], s["data"])
    return {"md": md, "redacted": resume.redact(md), "integrity": report}


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
    hit = align({k: v["level"] for k, v in levels.items()}, list(c.get("min_levels", {})))
    checks = []
    for skill, need in c.get("min_levels", {}).items():
        lvl, src, _ = hit.get(skill, (0, None, 0))
        checks.append({"criterion": f"{skill} >= {need}", "pass": lvl >= need, "found": lvl,
                       "matched": src, "evidence": levels[src]["evidence"][:1] if src else []})
    for tool in c.get("required_tools", []):  # tools: the resume text itself must show them
        rx = re.compile(rf"(?<![\w-]){re.escape(tool)}(?![\w-])", re.I)
        line = next((l.strip("-# ").strip()[:160] for l in s["md"].split("\n") if rx.search(l)), None)
        checks.append({"criterion": f"uses {tool}", "pass": bool(line), "evidence": [line] if line else []})
    if c.get("min_years") is not None:
        yrs = x.get("years_experience")
        checks.append({"criterion": f">= {c['min_years']} years", "pass": bool(yrs and yrs >= c["min_years"]), "found": yrs})
    if c.get("min_fit") is not None:
        checks.append({"criterion": f"match >= {c['min_fit']:.0%}", "pass": f.get("fit", 0) >= c["min_fit"],
                       "found": round(f.get("fit", 0), 2)})
    occ = occupation(s["soc"]) or {}
    integ = dict(s["integrity"])
    integ["findings"] = integ["findings"] + fraud_signals(s["md"], x.get("years_experience"), occ.get("description"),
                                                          s.get("seen"), len(x["skills"]))
    integ["risk"] = risk(integ["findings"])
    return {"checks": checks, "passed": all(ch["pass"] for ch in checks), "integrity": integ}


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


def screen(filename: str, data: bytes, soc: str, criteria: dict, board: dict | None = None,
           seen: set[str] | None = None) -> dict:
    """-> {md, redacted, analysis{skills, years, fit, checks, passed, integrity, held, usage}}. ValueError on bad files.
    seen: fingerprints of resumes already submitted to this opening (duplicate detection)."""
    s = _graph().invoke({"filename": filename, "data": data, "soc": soc, "criteria": criteria, "board": board, "seen": seen})
    analysis = {"skills": s["extraction"]["skills"], "years_experience": s["extraction"]["years_experience"],
                "fit": s["fit"].get("fit", 0.0), "coverage": s["fit"].get("coverage"), "top_gaps": s["fit"].get("top_gaps", []),
                "checks": s["checks"], "passed": s["passed"], "usage": s["usage"],
                "integrity": s["integrity"], "held": s["integrity"]["risk"]["hold"],
                "occupation": (occupation(soc) or {}).get("title")}
    return {"md": s["md"], "redacted": s["redacted"], "analysis": analysis}


def _pct(x: float) -> str:
    return f"{int(x * 100 + 0.5)}%"  # half-up, same as the UI's Math.round


def rank_candidates(apps: list[dict], criteria: dict) -> tuple[list[str], dict[str, str]]:
    """Ranking agent: candidates passing every hard criterion, by fit; top_k (default 5). -> (ids, reasons)."""
    k = criteria.get("top_k") or 5
    eligible = sorted((a for a in apps if a["analysis"].get("passed") and not a["analysis"].get("held")), key=lambda a: -a["fit"])
    chosen = eligible[:k]
    reasons = {}
    for i, a in enumerate(chosen, 1):
        an = a["analysis"]
        met = [c["criterion"] for c in an["checks"]]
        reasons[a["id"]] = (f"#{i}: match {_pct(a['fit'])} for {an.get('occupation')}; meets " +
                            (", ".join(met) if met else "the role requirements") +
                            (f"; main gaps {', '.join(an['top_gaps'][:2])}" if an.get("top_gaps") else ""))
    for a in apps:
        if a["id"] not in reasons and a["analysis"].get("held"):
            f = a["analysis"]["integrity"]["findings"]
            reasons[a["id"]] = ("Held for human review: document integrity " + a["analysis"]["integrity"]["risk"]["level"] +
                                " (" + ", ".join(dict.fromkeys(x["technique"] for x in f if x["severity"] in ("CRITICAL", "HIGH"))) + ").")
        elif a["id"] not in reasons:
            failed = [c["criterion"] for c in a["analysis"].get("checks", []) if not c["pass"]]
            reasons[a["id"]] = ("Not recommended: misses " + ", ".join(failed)) if failed else \
                f"Eligible but below the top {k} by match ({_pct(a['fit'])})."
    return [a["id"] for a in chosen], reasons
