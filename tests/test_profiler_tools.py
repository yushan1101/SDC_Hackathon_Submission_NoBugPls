"""The Profiler credits the job's tools as well as its skills, and reports unmatched skills in one note."""
from core.graph import run
from test_graph import req

DEV = "2514.2"  # ICT application developer: ESCO lists JavaScript among its tools


def test_listed_tool_is_credited_not_shown_as_a_full_gap():
    s = run(req(role=DEV, skills=(("JavaScript", 4), ("CSS", 3), ("MySQL", 3), ("Origami", 2))))
    js = next(g for g in s["skill_gaps"] if g.skill_id == "JavaScript")
    assert js.kind == "tool" and js.current_level == 4
    notes = [i for i in s["validation_issues"] if i.code == "unknown_skill"]
    assert len(notes) == 1 and "Origami" in notes[0].message
