"""Knowledge Agent: talks to the FastMCP server (in-process, or remote via MCP_URL).

Falls back to calling the tool functions directly if the MCP transport fails, so the demo stays up.
No evidence -> empty list, never an invented citation.
"""
import asyncio
import logging
from functools import lru_cache

from core.state import Evidence

log = logging.getLogger(__name__)


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


@lru_cache(maxsize=64)
def _role_skills_cached(role: str) -> dict:
    return call_tool("search_role_skills", {"role_id": role})


def search_role_skills(role: str):
    """-> ({skill: mention %}, evidence, meta incl. O*NET flags)."""
    r = _role_skills_cached(role)
    if not r.get("found"):
        return {}, [], {"retrieval_mode": "offline", "found": False}
    skills = {s["skill_id"]: s["mention_percent"] for s in r["skills"]}
    flags = {s["skill_id"]: {"onet_hot": s["onet_hot"], "onet_in_demand": s["onet_in_demand"],
                             "evidence_ids": s["evidence_ids"]} for s in r["skills"]}
    return skills, to_evidence(r["evidence"]), {"retrieval_mode": r["retrieval_mode"], "stale": True,
                                                "found": True, "flags": flags}


def labor_trends(role: str, scenario: str, top_k: int = 5):
    r = call_tool("search_labor_trends", {"role_id": role, "scenario": scenario, "top_k": top_k})
    return to_evidence(r["evidence"]), r["retrieval_mode"]


def learning_resources(skill: str, top_k: int = 2) -> list[Evidence]:
    return to_evidence(call_tool("retrieve_learning_resources", {"skill_id": skill, "top_k": top_k})["evidence"])


def known_skills() -> set[str]:
    from mcp_server.retrieval import offline_passages
    return {p["skill_id"] for p in offline_passages() if p["skill_id"]}


def evidence_id(role: str, skill: str) -> str:
    return f"data_jobs:{role}:{skill}"
