from agents.pathway import build
from core.state import Gap
from validation.revision import MAX_REVISIONS, revise

GAPS = [Gap(skill_id="Speaking", current_level=1, required_level=4, gap=3, importance=4.0, rationale_source_ids=["e1"])]


def test_forged_citation_repaired():  # T-06
    p = build(GAPS, 6, "Data Analyst", "assistive")
    p.activities[0].evidence_ids.append("fake:source")
    out, issues, n = revise(p, GAPS, {"e1"}, 6)
    assert n == 1 and out.status == "draft"
    assert all(e == "e1" for a in out.activities for e in a.evidence_ids)


def test_unrepairable_flagged_after_two():  # T-10
    p = build(GAPS, 6, "Data Analyst", "assistive")
    p.activities[0].estimated_hours = -5
    calls = []
    out, issues, n = revise(p, GAPS, {"e1"}, 6, repair_fn=lambda p, *a: calls.append(1) or p)
    assert n == MAX_REVISIONS == len(calls) and out.status == "flagged"


def test_generated_cannot_be_approved():
    p = build(GAPS, 6, "Data Analyst", "assistive").model_copy(update={"status": "approved"})
    out, _, _ = revise(p, GAPS, {"e1"}, 6)
    assert out.status == "draft"
