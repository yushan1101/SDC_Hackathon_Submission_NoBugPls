"""RunPod handler contract, run on CPU with a stub `runpod` module (the real one only exists in the worker image)."""
import importlib.util
import sys
import types
from pathlib import Path


def _handler():
    sys.modules.setdefault("runpod", types.SimpleNamespace(serverless=types.SimpleNamespace(start=lambda cfg: None)))
    spec = importlib.util.spec_from_file_location("rp_handler", Path(__file__).resolve().parents[1] / "runpod" / "handler.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler


def test_handler_tasks():
    h = _handler()
    assert "cuda" in h({"input": {"task": "health"}})
    out = h({"input": {"task": "embed", "texts": ["registered nurse", "electrician"]}})
    assert out["dim"] == 384 and len(out["vectors"]) == 2
    assert "error" in h({"input": {"task": "embed", "texts": []}})
    assert "error" in h({"input": {"task": "rm -rf /"}})
