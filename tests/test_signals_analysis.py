"""Trend-board multi-agent review: STF-KAN directions confirm or contradict the board, failures never lose the board."""
from agents import knowledge
from mcp_server import signals


def fake_tool(name, args, timeout=None):
    assert name == "skill_outlook"
    if args["role_id"] == "broken":
        raise RuntimeError("down")
    up = {"a": {"direction": "rising"}, "b": {"direction": "rising"}, "c": {"direction": "falling"}}
    return {"available": True, "forecast": {"mode": "live_cpu_inference"}, "outlook": up}


def test_analyze_verdicts(monkeypatch):
    monkeypatch.setattr(knowledge, "call_tool", fake_tool)
    board = {"emerging_roles": [{"soc": "x"}, {"soc": "broken"}], "declining_roles": [{"soc": "y"}]}
    a = signals.analyze(board)
    assert board["emerging_roles"][0]["stfkan"]["verdict"] == "confirmed"  # 2 rising > 1 falling
    assert board["declining_roles"][0]["stfkan"]["verdict"] == "contradicted"
    assert board["emerging_roles"][1]["stfkan"]["verdict"] == "no model evidence"
    assert (a["roles_reviewed"], a["confirmed"], a["contradicted"], a["no_model"]) == (3, 1, 1, 1)
