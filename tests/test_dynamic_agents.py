"""Follow-ups run only the agents a change affects, and reuse the rest (core/graph.py stream_followup)."""
from core import graph
from test_graph import req


def run_followup(prev, r):
    events = list(graph.stream_followup(prev, r))
    ran = [n for k, n, _ in events if k == "update"]
    reused = [n for k, n, _ in events if k == "reused"]
    return ran, reused, events[-1][2]


def test_hours_change_reruns_only_plan_side():
    first = graph.run(req(hours=6))
    ran, reused, s = run_followup(first, req(hours=12))
    assert ran == ["pathway", "coach", "reviewer"]
    assert set(reused) == {"profiler", "knowledge_search", "market_analyst", "gap_analysis"}
    assert [g.skill_id for g in s["skill_gaps"]] == [g.skill_id for g in first["skill_gaps"]]  # reused, not recomputed
    used = lambda st: sum(a.estimated_hours for a in st["draft_pathway"].activities)
    assert used(s) >= used(first) and s["status"] in ("draft", "flagged")


def test_scenario_and_skills_changes_reach_the_right_agents():
    first = graph.run(req())
    assert run_followup(first, req(scenario="agentic"))[0] == ["gap_analysis", "pathway", "coach", "reviewer"]
    ran, _, s = run_followup(first, req(skills=(("communication", 4), ("critical thinking", 2))))
    assert ran == ["profiler", "gap_analysis", "pathway", "coach", "reviewer"]


def test_new_job_or_no_previous_runs_everything():
    first = graph.run(req())
    events = list(graph.stream_followup(first, req(role="2511.1")))
    assert not any(k in ("plan", "reused") for k, _, _ in events)  # full graph
    assert not any(k == "reused" for k, _, _ in graph.stream_followup(None, req()))


def test_question_only_reexplains_and_keeps_warnings():
    first = graph.run(req())
    ran, _, s = run_followup(first, req(query="Explain my plan again and create a 30-60-90 day plan"))
    assert ran == ["coach", "reviewer"]
    profiler_warnings = first["issues_by_node"].get("profiler", [])
    assert all(i in s["validation_issues"] for i in profiler_warnings)  # reused agents' findings are kept


def test_followup_answer_is_about_the_change_not_a_repeat():
    first = graph.run(req(hours=6))
    _, _, s = run_followup(first, req(hours=12))
    f = s["followup"]
    assert f["changed"] == ["hours"] and f["weekly_hours"] == [6, 12] and "plan_hours" in f
    assert "open_gaps" not in f  # gaps were reused, so nothing to report there
    assert s["narrative"].startswith("With 12 h/week instead of 6")  # template mode (no LLM in tests)


def test_in_conversation_question_goes_to_the_coach():
    first = graph.run(req())
    ran, _, s = run_followup(first, req(query="what is critical thinking"))  # a "simple" question on its own
    assert ran == ["coach", "reviewer"] and s["followup"]["question"] == "what is critical thinking"
    ran, _, s = run_followup(first, req(query="write a poem"))  # off-topic: rejected by the router, no analysis agent runs
    assert s["route"] == "unsupported" and not set(ran) & set(graph.ORDER)


def test_vague_followups_in_a_conversation_are_not_rejected():
    first = graph.run(req())
    for msg in ("how can i improve it more quick", "it still reject it", "can I finish faster?"):
        ran, _, s = run_followup(first, req(query=msg))
        assert s["route"] == "complex" and ran == ["coach", "reviewer"], msg
    assert run_followup(first, req(query="tell me a joke"))[2]["route"] == "unsupported"
    # previous run lost (server restart) but still in a conversation: rebuild the briefing, don't reject
    final = list(graph.stream(req(query="how can i improve it more quick"), conversation=True))[-1][2]
    assert final["route"] == "complex" and final.get("draft_pathway") is not None
    assert list(graph.stream(req(query="how can i improve it more quick")))[-1][2]["route"] == "unsupported"  # first message, no context
