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
    assert len(q.learning_nodes) == 26 and {n.week_number for n in q.learning_nodes} == set(range(1, 14))
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
    assert len(journey.learning_nodes) == 26
    node = journey.learning_nodes[0]
    assert "Selecting and Filtering Rows" in node.title and "Data analyst" in node.learning_objective
    assert node.exercise and node.deliverable and node.completion_criteria
    assert "SELECT" in node.learn[0] and "WHERE" in node.learn[1]
    assert journey.learning_nodes[0].quiz.options == ["WHERE", "ORDER BY"]
    assert all(n.quiz and n.exercise and n.learn for n in journey.learning_nodes[:3])  # all three parts inside each step
    assert node.content_source == "guided_fallback"


def test_a_weeks_three_steps_each_get_their_own_task():
    from agents import pathway
    from core.state import Gap, LearningNode
    gaps = [Gap(skill_id="SQL", current_level=1, required_level=4, gap=3), Gap(skill_id="Data storytelling", current_level=2, required_level=3, gap=1)]
    p = pathway.build(gaps, 6, "Data analyst", "assistive")
    seeds = pathway._node_seeds(p, gaps, "Data analyst", [], {})
    nodes = pathway.expand_learning_nodes([LearningNode(**pathway._fallback_node(s, "Data analyst")) for s in seeds])
    steps = pathway.distinct_steps([n.model_dump() for n in nodes])
    week = steps[:3]
    for field in ("learn", "instructions", "exercise", "deliverable"):
        assert len({str(n[field]) for n in week}) == 3, field  # understand, practice and check never repeat each other
    assert len({n["quiz"]["question"] for n in week}) == 3
    assert all(n["quiz"]["options"][n["quiz"]["answer_index"]] for n in steps)
    assert len([LearningNode(**n) for n in steps]) == len(nodes)  # still valid nodes, none lost


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
    assert len(nodes) == 13 and nodes[0].content_source == "ai"
    assert all(not node.resource_ids for node in nodes)
    assert nodes[1].content_source == "guided_fallback" and "Color and Contrast" in nodes[1].title
    assert nodes[2].quiz.answer_index < len(nodes[2].quiz.options)


def test_fallback_lessons_for_an_uncatalogued_skill_differ_each_week():
    from agents.lessons import lesson_for
    topics = [lesson_for("Electronics principles", week, 0)[0] for week in range(1, 14)]
    assert len(set(topics)) == 13, topics
    assert topics[0] == "Core Ideas of Electronics principles" and "Applying" not in " ".join(topics)


def test_available_hours_and_assessed_gaps_change_weekly_step_count():
    from agents import pathway
    from core.state import Gap, LearningNode
    one = [Gap(skill_id="SQL", current_level=1, required_level=4, gap=3)]
    two = one + [Gap(skill_id="Dashboard design", current_level=1, required_level=3, gap=2)]
    compact_plan = pathway.build(one, 4, "Data analyst", "assistive")
    varied_plan = pathway.build(two, 8, "Data analyst", "assistive")
    compact = pathway._node_seeds(compact_plan, one, "Data analyst", [], {})
    varied = pathway._node_seeds(varied_plan, two, "Data analyst", [], {})
    assert len(compact) == 13 and len(varied) == 26
    assert [seed["id"] for seed in varied[:2]] == ["week-01", "week-01-02"]
    assert varied[0]["skills"] != varied[1]["skills"]
    assert all(seed["estimated_minutes"] >= 10 for seed in varied)
    assert sum(seed["estimated_minutes"] for seed in varied) == round(sum(a.estimated_hours for a in varied_plan.activities) * 60)
    assert sum(s["estimated_minutes"] for s in varied if s["week_number"] == 13) < sum(s["estimated_minutes"] for s in varied if s["week_number"] == 9)
    first = LearningNode(**pathway._fallback_node(varied[0], "Data analyst"))
    assert first.learn_minutes + first.practice_minutes + first.quiz_minutes == first.estimated_minutes
    assert first.quiz_minutes > 0


def test_old_plans_without_learning_nodes_get_a_roadmap_and_keep_their_ticks():
    from server.api import _learning_plan_view, _learning_progress_rows
    plan = {"target_role": "Database designer", "scenario": "assistive", "activities": [
        {"day_range": d, "skill_id": s, "activity": f"Work on {s}", "estimated_hours": 8.0}
        for d, s in [("1-30", "Information structure"), ("31-60", "Information structure"), ("61-90", "Systems theory")]]}
    nodes = _learning_plan_view(plan)["learning_nodes"]
    assert {n["week_number"] for n in nodes} == set(range(1, 14)) and "learning_nodes" not in plan  # shown, not saved
    assert not any("level 0" in n["learning_objective"] for n in nodes)  # no invented levels
    rows = dict(_learning_progress_rows(plan, [("1-30:Information structure", "2026-10-01T00:00:00Z")]))
    week1 = [n["id"] for n in nodes if n["week_number"] <= 4]
    assert all(rows.get(f"node:{i}") == "2026-10-01T00:00:00Z" for i in week1)
    assert not any(k.startswith("node:") and "week-05" in k for k in rows)
    # unticking a carried-over step sticks: the marker stops it being re-derived
    rows.pop(f"node:{week1[0]}")
    assert f"node:{week1[0]}" not in dict(_learning_progress_rows(plan, list(rows.items())))


def test_plan_view_gives_each_week_several_tasks_each_with_learn_practice_quiz():
    from server.api import _learning_plan_view
    from agents import pathway
    from core.state import Gap, LearningNode
    plan = pathway.build([Gap(skill_id="SQL", current_level=1, required_level=3, gap=2)], 3, "Data analyst", "assistive")
    plan.learning_nodes = [LearningNode(**pathway._fallback_node(s, "Data analyst"))
                           for s in pathway._node_seeds(plan, [Gap(skill_id="SQL", current_level=1, required_level=3, gap=2)], "Data analyst", [], {})]
    nodes = _learning_plan_view(plan.model_dump())["learning_nodes"]
    week1 = [n for n in nodes if n["week_number"] == 1]
    assert len(week1) == 3 and len({n["title"] for n in week1}) == 3
    assert len({n["quiz"]["question"] for n in week1}) >= 2  # the tasks don't just repeat one quiz
    for n in nodes:
        assert _has_learn_practice_quiz(n)
        assert n["learn_minutes"] + n["practice_minutes"] + n["quiz_minutes"] == n["estimated_minutes"]


def _has_learn_practice_quiz(node: dict) -> bool:
    quiz = node.get("quiz") or {}
    return bool(node.get("learn") and node.get("exercise") and node.get("deliverable") and len(node.get("instructions") or []) >= 2
                and quiz.get("question") and len(quiz.get("options") or []) >= 2 and 0 <= quiz.get("answer_index", -1) < len(quiz["options"])
                and min(node["learn_minutes"], node["practice_minutes"], node["quiz_minutes"]) >= 1
                and node["learn_minutes"] + node["practice_minutes"] + node["quiz_minutes"] == node["estimated_minutes"])


def test_normaliser_backfills_learn_practice_quiz_without_touching_the_saved_step():
    import copy
    from agents import pathway
    from core.state import LearningNode
    gaps = [__import__("core.state", fromlist=["Gap"]).Gap(skill_id="SQL", current_level=1, required_level=3, gap=2)]
    plan = pathway.build(gaps, 4, "Data analyst", "assistive")
    seeds = pathway._node_seeds(plan, gaps, plan.target_role, [], {})
    full = [pathway._fallback_node(seed, plan.target_role) for seed in seeds[:3]]
    broken = copy.deepcopy(full)
    broken[0].update(quiz=None, quiz_minutes=0, learn_minutes=0, practice_minutes=0)       # an old step saved without a quiz
    broken[1].update(learn=[], exercise="", instructions=["Only one step"])                # parts left out by the model
    broken[2]["quiz"] = {"question": "Broken?", "options": ["a", "b"], "answer_index": 9, "explanation": "x"}
    saved = copy.deepcopy(broken)
    fixed = pathway.ensure_learn_practice_quiz(broken, plan.target_role)
    assert broken == saved  # never mutates the stored plan
    assert all(_has_learn_practice_quiz(node) for node in fixed)
    assert all(LearningNode(**node) for node in fixed)
    assert fixed[0]["deliverable"] in fixed[0]["quiz"]["options"]  # the backfilled quiz checks the step's own work sample
    assert fixed[1]["instructions"][0] == "Only one step" and fixed[1]["deliverable"] == full[1]["deliverable"]  # kept as written
    assert fixed[2]["quiz"]["answer_index"] < len(fixed[2]["quiz"]["options"])
    untouched = pathway.ensure_learn_practice_quiz(full, plan.target_role)
    assert [{k: n[k] for k in ("learn", "instructions", "exercise", "deliverable", "quiz")} for n in untouched] == \
           [{k: n[k] for k in ("learn", "instructions", "exercise", "deliverable", "quiz")} for n in full]


def test_every_week_gets_a_learn_practice_quiz_step_even_with_very_little_time(monkeypatch):
    from agents import llm, pathway
    from core.state import Gap, Pathway, PathwayActivity
    monkeypatch.setattr(llm, "generate", lambda *args, **kwargs: (None, None))
    gaps = [Gap(skill_id="SQL", current_level=1, required_level=3, gap=2)]
    # 0.3 h per phase: before, short weeks were dropped and only some weeks had a lesson
    tiny = Pathway(target_role="Data analyst", scenario="assistive", activities=[
        PathwayActivity(day_range=d, skill_id="SQL", activity="Practise SQL queries", estimated_hours=0.3) for d in ("1-30", "31-60", "61-90")])
    seeds = pathway._node_seeds(tiny, gaps, "Data analyst", [], {})
    assert sorted({s["week_number"] for s in seeds}) == list(range(1, 14))
    assert all(s["estimated_minutes"] >= 5 for s in seeds)
    for hours in (1, 4, 8, 20):
        p = pathway.build(gaps, hours, "Data analyst", "assistive")
        nodes, _ = pathway._learning_nodes(p, "Data analyst", gaps, [], {})
        assert sorted({n.week_number for n in nodes}) == list(range(1, 14)), hours
        assert all(_has_learn_practice_quiz(n.model_dump()) for n in nodes), hours


def test_ai_steps_missing_a_part_are_backfilled_not_dropped(monkeypatch):
    import json
    from agents import llm, pathway
    from core.state import Gap
    gaps = [Gap(skill_id="Visual design", current_level=0, required_level=3, gap=3)]
    plan = pathway.build(gaps, 4, "Graphic designer", "assistive")
    seeds = pathway._node_seeds(plan, gaps, plan.target_role, [], {})
    lessons = [pathway._fallback_node(seed, plan.target_role) | {"title": f"Design step {i} for posters"} for i, seed in enumerate(seeds)]
    lessons[3]["learn"] = []           # the model forgot Learn
    lessons[4].pop("exercise")         # ... and the practice task
    lessons[5]["instructions"] = []
    for lesson in lessons:
        lesson.update(learn_minutes=1, practice_minutes=1, quiz_minutes=1)  # model-supplied split that doesn't add up
    monkeypatch.setattr(llm, "generate", lambda *args, **kwargs: (json.dumps({"nodes": lessons}), None))
    nodes, _ = pathway._learning_nodes(plan, plan.target_role, gaps, [], {})
    assert len(nodes) == len(seeds) and sorted({n.week_number for n in nodes}) == list(range(1, 14))
    assert all(n.content_source == "ai" for n in nodes)  # the AI's lessons are kept, the missing parts filled in
    assert all(_has_learn_practice_quiz(n.model_dump()) for n in nodes)
    assert nodes[3].learn and nodes[4].exercise and len(nodes[5].instructions) >= 2
