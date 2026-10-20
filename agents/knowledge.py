"""Knowledge Agent: occupation requirements for ANY ESCO occupation, via the FastMCP server.

Live evidence = ESCO v1.2 (European Commission, public): occupations, descriptions, essential/optional skills,
with importance and level predicted by a model trained offline on O*NET ratings. O*NET itself, the O*NET
release history and the 2023 job-ad dataset are TRAINING data only and are never read here.
Falls back to calling the tool functions directly if the MCP transport fails, so the demo stays up.
"""
import asyncio
import json
import logging
import re
from functools import lru_cache

from core.state import Evidence

log = logging.getLogger(__name__)
SOC = re.compile(r"^\d{4}(\.\d+)*$")  # ESCO occupation code (ISCO-08 unit group + ESCO suffix)


@lru_cache(maxsize=1)
def snapshot() -> dict:
    from mcp_server.ingest import SNAPSHOT
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def occupation(soc: str) -> dict | None:
    return snapshot()["occupations"].get(soc)


@lru_cache(maxsize=1)
def _title_index() -> dict[str, str]:
    idx = {t.lower(): soc for t, soc in snapshot()["titles"]}
    idx.update({o["title"].lower(): soc for soc, o in snapshot()["occupations"].items()})  # official titles win
    return idx


def resolve_occupation(text: str) -> str | None:
    """ESCO code, preferred title or any ESCO alternative label (case-insensitive) -> ESCO code."""
    t = (text or "").strip()
    if SOC.match(t):
        return t if occupation(t) else None
    idx, low = _title_index(), t.lower()
    return idx.get(low) or idx.get(re.sub(r"(?<=[a-z]{3})s\b", "", low))  # "Electricians" -> "electrician"


def search_occupations(query: str, limit: int = 12) -> list[dict]:
    """Every query word must appear in the title; official occupation titles rank above alternate titles."""
    words = [re.sub(r"(?<=[a-z]{3})s$", "", w) for w in re.findall(r"[a-z0-9]+", (query or "").lower())]
    if not words:
        return []
    occ = snapshot()["occupations"]
    hits: dict[str, tuple] = {}
    for title, soc in [(o["title"], s) for s, o in occ.items()] + [tuple(x) for x in snapshot()["titles"]]:
        low = title.lower()
        if all(w in low for w in words):
            official = title == occ[soc]["title"]
            score = (not official, not low.startswith(words[0]), len(title))
            if soc not in hits or score < hits[soc][0]:
                hits[soc] = (score, title)
    ranked = sorted(hits.items(), key=lambda kv: kv[1][0])[:limit]
    return [{"soc": soc, "title": occ[soc]["title"], "matched": t if t != occ[soc]["title"] else None,
             "job_zone": occ[soc]["job_zone"]} for soc, (_, t) in ranked]


def call_tool(name: str, args: dict) -> dict:
    from config.settings import get_settings
    from mcp_server import server
    try:
        from fastmcp import Client

        async def go():
            async with Client(get_settings().mcp_url or server.mcp) as c:
                return (await c.call_tool(name, args)).data
        return asyncio.run(go())
    except Exception as e:
        log.warning("MCP call %s failed (%s); direct fallback", name, type(e).__name__)
        fn = getattr(server, name)
        return getattr(fn, "fn", fn)(**args)


def to_evidence(items: list[dict]) -> list[Evidence]:
    return [Evidence(**{k: v for k, v in e.items() if k in Evidence.model_fields}) for e in items]


@lru_cache(maxsize=256)
def _role_cached(soc: str) -> dict:
    return call_tool("search_role_skills", {"role_id": soc})


def role_requirements(role: str):
    """-> (requirements {id: {kind, required, importance, evidence_id, hot, in_demand}}, evidence, meta)."""
    soc = resolve_occupation(role)
    if not soc:
        return {}, [], {"retrieval_mode": "offline", "found": False}
    r = _role_cached(soc)
    reqs = {x["skill_id"]: x for x in r["requirements"]}
    return reqs, to_evidence(r["evidence"]), {"retrieval_mode": "exact", "found": True, "soc": soc,
                                              "title": r["title"]}


def labor_trends(role: str, scenario: str, top_k: int = 4):
    soc = resolve_occupation(role)
    if not soc:
        return [], "offline"
    r = call_tool("search_labor_trends", {"role_id": soc, "scenario": scenario, "top_k": top_k})
    return to_evidence(r["evidence"]), r["retrieval_mode"]


def learning_resources(skill: str, top_k: int = 2) -> list[Evidence]:
    return to_evidence(call_tool("retrieve_learning_resources", {"skill_id": skill, "top_k": top_k})["evidence"])


@lru_cache(maxsize=1)
def known_skills() -> frozenset[str]:  # every ESCO skill label used by an occupation
    occ = snapshot()["occupations"].values()
    return frozenset({s for o in occ for s in o["skills"]} | {t["name"] for o in occ for t in o["tech"]})
