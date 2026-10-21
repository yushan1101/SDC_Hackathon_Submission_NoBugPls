"""Runtime STF-KAN serving (blueprint section 7): live CPU inference is real, gated, and labeled when it falls back."""
import json
import random

import pytest

from forecasting import serving
from validation.forecast_checks import check_outlook

LIVE = all(p.exists() for p in serving.paths())
needs_artifacts = pytest.mark.skipif(not LIVE, reason="trained checkpoint/history not installed (gitignored)")


def test_gate_missing_artifacts_is_unavailable(tmp_path):
    with pytest.raises(serving.Unavailable, match="manifest"):
        serving.outlook_for({"x": ("s", "i", "skill")}, tmp_path / "m.pt", tmp_path / "h.csv", tmp_path / "man.json")


def test_gate_rejects_checkpoint_not_matching_manifest(tmp_path):
    ck, hist, man = tmp_path / "m.pt", tmp_path / "h.csv", tmp_path / "man.json"
    ck.write_bytes(b"tampered"), hist.write_text("soc,item,kind\n")
    man.write_text(json.dumps({"checkpoint_sha256": "0" * 64, "dataset_checksum": serving.sha256(hist)}))
    with pytest.raises(serving.Unavailable, match="checkpoint does not match"):
        serving.outlook_for({"x": ("s", "i", "skill")}, ck, hist, man)


@needs_artifacts
def test_live_cpu_inference_reproduces_exported_asset():
    """Not a lookup: the checkpoint runs at request time and matches what the offline export wrote."""
    asset = json.loads((serving.SRC / "data/training_snapshots/onet_outlook.json").read_text(encoding="utf-8"))["occupations"]
    recs = [(soc, item, r) for soc, items in asset.items() for item, r in items.items()]
    sample = random.Random(0).sample(recs, 300) + [x for x in recs if x[2]["direction"] == "rising"][:50]
    pairs = {f"{soc}|{item}": (soc, item, "skill" if r["unit"].startswith("O*NET") else "tool") for soc, item, r in sample}
    out, meta = serving.outlook_for(pairs)
    assert meta["mode"] == "live_cpu_inference" and meta["device"] == "cpu" and meta["model_version"]
    for soc, item, r in sample:
        assert out[f"{soc}|{item}"] == r


def test_fallback_to_exported_asset_is_labeled(monkeypatch):
    from mcp_server import server

    def down(*a, **k):
        raise serving.Unavailable("trained checkpoint not installed (stf_kan_best.pt)")
    monkeypatch.setattr(serving, "outlook_for", down)
    r = getattr(server.skill_outlook, "fn", server.skill_outlook)("2149.2")
    assert r["forecast"]["mode"] == "precomputed_asset" and "checkpoint not installed" in r["forecast"]["reason"]
    assert [i.code for i in check_outlook(r["outlook"], r["forecast"])] == ["forecast_precomputed"]


def test_outlook_checks_reject_bad_values():
    fc = {"status": "available", "mode": "live_cpu_inference", "model_version": "v"}
    good = {"a": {"current": 3.0, "forecast": [3.1, 3.2], "direction": "rising", "unit": "O*NET importance (1-5)"}}
    bad = {"a": {"current": 3.0, "forecast": [7.0], "direction": "rising", "unit": "O*NET importance (1-5)"}}
    assert check_outlook(good, fc) == []
    assert [i.code for i in check_outlook(bad, fc)] == ["forecast_bounds"]
    assert [i.code for i in check_outlook({}, {"status": "unavailable", "reason": "x"})] == ["forecast_unavailable"]
    assert [i.code for i in check_outlook(good, {"status": "available"})] == ["forecast_label"]


def test_agent_workflow_uses_gated_forecast():
    """End to end: the Market Analyst's outlook comes from live inference (or a labeled fallback) and ranks gaps."""
    from core.graph import run
    from core.state import Profile, Request, Skill
    s = run(Request(request_id="t", profile=Profile(skills=[Skill(name="communication", level=3)], weekly_learning_hours=6),
                    target_role="2149.2", scenario="agentic", query="Analyze my skill gaps and create a 30-60-90 day plan"))
    f = s["forecast"]
    assert f["status"] == "available" and f["mode"] == ("live_cpu_inference" if LIVE else "precomputed_asset")
    rising = [k for k, v in s["outlook"].items() if v["direction"] == "rising"]
    assert rising and {f"stfkan:2149.2:{k}" for k in rising} <= {e.id for e in s["evidence"]}
    if LIVE:
        assert all(v["source_series"].startswith("15-") for v in s["outlook"].values())
