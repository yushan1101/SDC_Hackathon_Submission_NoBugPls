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

    def fake_stream(prompt, system, **kw):  # the model writes plain-text blocks, a few characters at a time
        seen["prompt"] = prompt
        slots = _json.loads(prompt.split("<DATA>\n", 1)[1].rsplit("\n</DATA>", 1)[0])["slots"]
        blocks = []
        for n, s in enumerate(slots, 1):
            lo, hi = s["weeks"].split("-")
            if n == len(slots):
                lo, hi = "40", "41"  # out of its phase: this one must keep its template text
            blocks.append(f"### {n}\nActivity: Rebuild your team's weekly Excel report in {s['skill']} with real sales data\n"
                          f"- Week {lo}: Pull last month's orders and sketch the report\n"
                          f"- Week {hi}: Ship it to your manager and compare the time it takes\n"
                          "Outcome: A working report your manager uses\n")
        text = "\n".join(blocks)
        for i in range(0, len(text), 7):
            yield {"delta": text[i:i + 7]}
        yield {"usage": None}
    monkeypatch.setattr(llm, "generate_stream", fake_stream)
    monkeypatch.setattr(llm, "generate", lambda *args, **kwargs: (None, None))
    events = []
    q, _ = pathway.personalise(p, "Data analyst", [Skill(name="Excel", level=4)], gaps, "Move into analytics", learning, events.append)
    kinds = [e["t"] for e in events]
    assert kinds[0] == "plan_start" and kinds.count("plan_token") > 10  # the page sees it being written
    written = [e for e in events if e["t"] == "plan_activity"]
    assert sorted(e["slot"] for e in written) == list(range(len(p.activities)))  # every slot is confirmed once
    assert written[0]["slot"] == 0 and kinds.index("plan_activity") < len(kinds) - len(written)  # the first lands mid-stream
    assert [e["ai"] for e in sorted(written, key=lambda e: e["slot"])][-1] is False and written[0]["ai"] is True
    assert "Read the ESCO skill guide" not in seen["prompt"] and "Weeks 1-2" not in seen["prompt"]  # no template to copy
    assert "SQL for Data Analysis" in seen["prompt"] and '"strengths": ["Excel"]' in seen["prompt"]
    assert q.activities[0].activity.startswith("Rebuild your team's weekly Excel report") and q.activities[0].steps[0].startswith("Week 1:")
    assert q.activities[-1].activity == p.activities[-1].activity  # bad weeks: the template stays
    assert [a.estimated_hours for a in q.activities] == [a.estimated_hours for a in p.activities]  # hours never change
    assert len(q.learning_nodes) == 39 and {n.week_number for n in q.learning_nodes} == set(range(1, 14))
    assert all(n.title and n.learning_objective and n.topics and n.instructions and n.exercise and n.completion_criteria for n in q.learning_nodes)


def test_learning_nodes_have_role_and_gap_specific_fallback(monkeypatch):
    from agents import llm, pathway
    from core.state import Gap, Skill
    monkeypatch.setattr(llm, "generate_stream", lambda *args, **kwargs: iter(()))
    monkeypatch.setattr(llm, "generate", lambda *args, **kwargs: (None, None))
    gaps = [Gap(skill_id="SQL", current_level=1, required_level=4, gap=3),
            Gap(skill_id="Data storytelling", current_level=2, required_level=3, gap=1)]
    plan = pathway.build(gaps, 6, "Data analyst", "assistive", skills=[Skill(name="Excel", level=4)])
    journey, _ = pathway.personalise(plan, "Data analyst", [Skill(name="Excel", level=4)], gaps)
    assert len(journey.learning_nodes) == 39
    node = journey.learning_nodes[0]
    assert "Selecting and Filtering Rows" in node.title and "Data analyst" in node.learning_objective
    assert node.exercise and node.deliverable and node.completion_criteria
    assert "SELECT" in node.learn[0] and "WHERE" in node.learn[1]
    assert [n.type for n in journey.learning_nodes[:3]] == ["learn", "practice", "quiz"]
    assert journey.learning_nodes[2].quiz.options == ["WHERE", "ORDER BY"]
    assert node.content_source == "guided_fallback"


def test_distinct_skill_lessons_and_saved_week_expansion(monkeypatch):
    from agents import pathway
    from core.state import Gap, LearningNode, Pathway
    design = [Gap(skill_id="Visual design", current_level=0, required_level=3, gap=3)]
    p = pathway.build(design, 4, "Graphic designer", "assistive")
    seed = pathway._node_seeds(p, design, "Graphic designer", [], {})[0]
    lesson = LearningNode(**pathway._fallback_node(seed, "Graphic designer"))
    nodes = pathway.expand_learning_nodes([lesson])
    assert "Visual Hierarchy" in nodes[0].title and "poster" in nodes[1].exercise
    assert nodes[2].quiz and "heading" in nodes[2].quiz.question
    assert sum(n.estimated_minutes for n in nodes) == lesson.estimated_minutes
    assert pathway.expand_learning_nodes(nodes) == nodes  # reloading never duplicates steps
    Pathway(target_role=p.target_role, scenario=p.scenario, activities=p.activities,
            learning_nodes=[LearningNode(**node.model_dump()) for node in nodes])


def test_ai_lessons_expand_with_matching_quizzes_and_only_retrieved_resources(monkeypatch):
    import json
    from agents import llm, pathway
    from core.state import Gap
    gaps = [Gap(skill_id="Visual design", current_level=0, required_level=3, gap=3)]
    plan = pathway.build(gaps, 4, "Graphic designer", "assistive")
    lessons = [pathway._fallback_node(seed, plan.target_role) for seed in pathway._node_seeds(plan, gaps, plan.target_role, [], {})]
    for lesson in lessons:
        lesson["resource_ids"] = ["invented-course"]
    lessons[1]["quiz"]["answer_index"] = 99  # unusable quiz falls back with its matching lesson
    monkeypatch.setattr(llm, "generate", lambda *args, **kwargs: (json.dumps({"nodes": lessons}), None))
    nodes, _ = pathway._learning_nodes(plan, plan.target_role, gaps, [], {})
    assert len(nodes) == 39 and nodes[0].content_source == "ai"
    assert all(not node.resource_ids for node in nodes)
    assert nodes[3].content_source == "guided_fallback" and "Color and Contrast" in nodes[3].title
    assert nodes[5].quiz.answer_index < len(nodes[5].quiz.options)
