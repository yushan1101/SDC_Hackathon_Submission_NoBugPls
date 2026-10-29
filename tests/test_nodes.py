"""Multi-node: the worker node rejects calls without NODE_TOKEN (main-node side: test_api.test_node_config_needs_token)."""
def test_worker_requires_token():
    from fastapi.testclient import TestClient
    from mcp_server.server import mcp
    from worker import RequireToken
    with TestClient(RequireToken(mcp.http_app(path="/mcp"), "s3cret")) as c:
        assert c.get("/").status_code == 200  # host health check stays open
        assert c.post("/mcp", json={}).status_code == 401
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer nope"}).status_code == 401
        assert c.post("/mcp", json={}, headers={"Authorization": "Bearer s3cret"}).status_code != 401


def test_ai_writes_the_plan_steps_itself_and_bad_weeks_fall_back(monkeypatch):
    import json as _json
    from agents import llm, pathway
    from core.state import Evidence, Gap, Skill
    gaps = [Gap(skill_id="SQL", current_level=1, required_level=4, gap=3),
            Gap(skill_id="Dashboards", current_level=0, required_level=3, gap=3)]
    learning = {"SQL": [Evidence(id="c1", title="SQL for Data Analysis", publication_date="2026-01", url="https://example.com", excerpt="")]}
    p = pathway.build(gaps, 6, "Data analyst", "assistive", learning, [Skill(name="Excel", level=4)])
    seen = {}

    def fake(prompt, system, **kw):
        seen["prompt"] = prompt
        slots = _json.loads(prompt.split("<DATA>\n", 1)[1].rsplit("\n</DATA>", 1)[0])["slots"]
        out = [{"activity": f"Rebuild your team's weekly Excel report in {s['skill']} with real sales data",
                "steps": [f"Week {s['weeks'].split('-')[0]}: Pull last month's orders and sketch the report",
                          f"Week {s['weeks'].split('-')[1]}: Ship it to your manager and compare the time it takes"],
                "outcome": "A working report your manager uses"} for s in slots]
        out[-1]["steps"] = ["Week 40: Out of range", "Week 41: Also out"]  # this one must keep its template text
        return _json.dumps({"activities": out}), None
    monkeypatch.setattr(llm, "generate", fake)
    q, _ = pathway.personalise(p, "Data analyst", [Skill(name="Excel", level=4)], gaps, "Move into analytics", learning)
    assert "Read the ESCO skill guide" not in seen["prompt"] and "Weeks 1-2" not in seen["prompt"]  # no template to copy
    assert "SQL for Data Analysis" in seen["prompt"] and '"strengths": ["Excel"]' in seen["prompt"]
    assert q.activities[0].activity.startswith("Rebuild your team's weekly Excel report") and q.activities[0].steps[0].startswith("Week 1:")
    assert q.activities[-1].activity == p.activities[-1].activity  # bad weeks: the template stays
    assert [a.estimated_hours for a in q.activities] == [a.estimated_hours for a in p.activities]  # hours never change
