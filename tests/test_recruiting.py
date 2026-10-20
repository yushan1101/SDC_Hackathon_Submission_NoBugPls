"""Unit tests for the must-have layers: trend signals, role matching, quiz, resume intake, NL criteria, SDGs,
screening agents. No network: the trend board is built from synthetic counts."""
from datetime import date

import pytest

from agents import criteria, quiz, resume, sdg
from agents.matcher import match_roles
from core.screening import rank_candidates, screen
from mcp_server import signals

NURSE = open("data/samples/sample_resume_nurse.md", "rb").read()


def test_trend_model_detects_growth_and_stability():
    up = signals.loglinear_trend([2, 3, 5, 8, 12, 18, 27, 40])
    flat = signals.loglinear_trend([10, 9, 11, 10, 10, 9, 11, 10])
    assert up["z"] > 2 and up["weekly_growth_pct"] > 30 and up["forecast_4w"][-1] > up["forecast_4w"][0] > 30
    assert abs(flat["z"]) < 2 and signals._direction(flat["z"]) == "stable"
    assert signals.rate_test(60, 14, 60, 42) > 2  # 3x the daily rate


def test_daily_board_is_dated_and_evidence_backed():
    hn = {t["id"]: [5] * 8 for t in signals.TOPICS}
    hn["ai-healthcare"] = [1, 2, 3, 6, 10, 16, 25, 40]
    jobs = [{"text": "Clinical AI nurse informatics role using AI medical tools"}] * 5 + [{"text": "Barista"}] * 95
    b = signals.build_board(date(2026, 10, 20), hn, {}, jobs, ["arbeitnow"], {})
    top = b["topics"][0]
    assert top["id"] == "ai-healthcare" and top["direction"] == "rising"
    assert all(i.startswith("signal:2026-10-20:") for t in b["topics"] for i in t["evidence_ids"])
    assert {e["id"] for e in b["evidence"]} >= set(top["evidence_ids"])
    healthy = [r["soc"][:2] for r in b["emerging_roles"][:5]]
    assert healthy.count("29") + healthy.count("31") >= 3  # healthcare roles pulled forward


def test_match_roles_field_filter_and_training_ceiling():
    levels = {"Monitoring": 4, "Active Listening": 4, "Service Orientation": 4, "Critical Thinking": 3}
    rows = match_roles(levels, 8, soc_prefixes=["29", "31"], max_zone=3)
    assert rows and all(r["soc"][:2] in ("29", "31") and r["job_zone"] <= 4 for r in rows)
    assert all(r["stretch"] == (r["job_zone"] == 4) for r in rows)
    rows = match_roles({"Repairing": 4, "Troubleshooting": 4, "Equipment Maintenance": 4}, 5)
    assert sum(r["soc"].startswith(("49", "47", "51")) for r in rows) >= 3


def test_quiz_scoring():
    lv, px = quiz.score({"broken": 3, "monitor": 2, "crew": 1, "nope": 3}, ["trades", "unknown"])
    assert lv["Repairing"] == 4 and lv["Coordination"] == 2 and px == ["47", "49"]
    assert {q["id"] for q in quiz.questions()["questions"]} >= {"manual", "code", "broken"}


def test_resume_markdown_redaction_and_evidence():
    md = resume.to_markdown("cv.md", NURSE)
    red = resume.redact(md)
    assert "Jordan" not in red and "example.com" not in red and "555" not in red and "(2021-2026)" in red
    x = resume.extract(md)
    names = {s["name"] for s in resume.verify(md, x["skills"])}
    assert {"Critical Thinking", "Epic Systems", "Microsoft Excel"} <= names and x["years_experience"] == 6
    assert all(q in md for s in x["skills"] for q in s["evidence"])  # every claim quotes the resume
    with pytest.raises(ValueError):
        resume.to_markdown("cv.exe", b"MZ")


def test_criteria_parser_and_refusal():
    c = criteria.parse("Top 3. Must know Epic and Excel, critical thinking at least 3, 3+ years, match above 60%")
    assert (c["top_k"], c["min_years"], c["min_fit"]) == (3, 3, 0.6)
    assert c["min_levels"] == {"Critical Thinking": 3} and "Epic Systems" in c["required_tools"]
    assert criteria.parse("young women only")["blocked"]
    assert any("Not understood" in n for n in criteria.parse("top 2, good vibes")["notes"])


def test_sdg_mapping_is_confident_or_baseline():
    items, ev = sdg.role_sdgs("29-1141.00")
    assert items[0]["goal"] == 3 and ev[0].id == "sdg:29-1141.00:3" and "not an official" in ev[0].excerpt
    assert all(1 <= x["goal"] <= 17 for s in ("47-2111.00", "25-2021.00", "45-2092.00") for x in sdg.role_sdgs(s)[0])
    assert sdg.confident([{"goal": 14, "score": 0.05, "z": 0.1}]) == [sdg.DECENT_WORK]
    assert sdg.links_for("Programming")[:2] == ["SDG4", "SDG8"]


def test_screening_agents_and_ranking():
    c = criteria.parse("top 1, must know Epic, 3+ years")
    good = screen("cv.md", NURSE, "29-1141.00", c)["analysis"]
    weak = screen("cv.md", b"# Sam\n\nRetail assistant. Customer service.", "29-1141.00", c)["analysis"]
    assert good["passed"] and not weak["passed"]
    assert [u["node"] for u in good["usage"]] == ["parse_resume", "extract_skills", "assess_fit", "judge_criteria"]
    ids, why = rank_candidates([{"id": "a", "fit": good["fit"], "analysis": good},
                                {"id": "b", "fit": weak["fit"], "analysis": weak}], c)
    assert ids == ["a"] and why["a"].startswith("#1") and "misses" in why["b"]
