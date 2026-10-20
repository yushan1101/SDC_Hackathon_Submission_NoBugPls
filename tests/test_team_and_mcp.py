import asyncio

import pandas as pd

from agents.knowledge import resolve_occupation
from core.team_import import parse_team


def test_team_csv_validation():
    ok = pd.read_csv("data/samples/sample_team.csv")
    reqs, errs = parse_team(ok, resolve_occupation, "assistive", 5000, 500)
    assert not errs and len(reqs) == 5 and all(r.audience == "hr" for r in reqs)
    assert {r.target_role for r in reqs} >= {"2221.2", "7411.1"}  # nurse, electrician resolved to ESCO codes
    bad = ok.copy()
    bad.loc[0, "employee_id"] = "jane.doe@corp.com"
    bad.loc[1, "level"] = 9
    bad.loc[2, "target_role"] = "Astronaut chef of Mars"
    reqs, errs = parse_team(bad, resolve_occupation, "assistive", 5000, 500)
    assert reqs == [] and len(errs) >= 3
    assert parse_team(ok.drop(columns=["skill"]), resolve_occupation, "assistive", 5000, 500)[1]


def test_mcp_tools_over_protocol():
    from fastmcp import Client
    from mcp_server.server import mcp

    async def go():
        async with Client(mcp) as c:
            names = {t.name for t in await c.list_tools()}
            rs = (await c.call_tool("search_role_skills", {"role_id": "2221.2"})).data
            lr = (await c.call_tool("retrieve_learning_resources", {"skill_id": "Address problems critically"})).data
            return names, rs, lr
    names, rs, lr = asyncio.run(go())
    assert {"search_labor_trends", "search_role_skills", "retrieve_learning_resources", "search_occupations",
            "skill_outlook"} <= names and "forecast_skill_demand" not in names  # no 2023-data tool at runtime
    assert rs["found"] and rs["title"] == "Nurse responsible for general care" and all(e["url"].startswith("https://") for e in rs["evidence"])
    assert lr["evidence"] and all(e["id"] == "learn:Address problems critically" for e in lr["evidence"])


def test_labor_trends_respects_as_of_cutoff():  # SDLC 4.3: no future-dated passages for historical as-of
    from mcp_server.server import search_labor_trends
    fn = getattr(search_labor_trends, "fn", search_labor_trends)
    r = fn("2221.2", "assistive", as_of_date="2023-12-31")
    assert all(not e["publication_date"][:4].isdigit() or e["publication_date"] <= "2023-12-31" for e in r["evidence"])
