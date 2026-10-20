"""RunPod serverless handler: the project's GPU workloads behind one endpoint.

Deploy with runpod/Dockerfile as a RunPod Serverless Endpoint (any CUDA GPU; a 16-24 GB card is plenty).
Mount a network volume at /runpod-volume holding data/ (O*NET zip, ESCO snapshot) and receiving artifacts/;
they are linked into src/data and src/artifacts.

Jobs ({"input": {...}}):
  {"task": "embed", "texts": ["..."]}                      -> MiniLM vectors (batch resume / occupation encoding)
  {"task": "train_stfkan", "seeds": [42, 7, 2026]}         -> STF-KAN on the O*NET release history (training only)
  {"task": "train_requirements"}                            -> requirement model trained on O*NET, scores ESCO
  {"task": "health"}                                        -> GPU name, CUDA availability
Budget rule (AGENTS.md): RunPod total <= $25; check the per-second rate before launching and keep jobs short.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import runpod

SRC = Path(__file__).resolve().parents[1] / "src"  # code, scripts/, data/ and artifacts/ all live here
VOLUME = Path(os.getenv("RUNPOD_VOLUME", "/runpod-volume"))
sys.path.insert(0, str(SRC))
MAX_TEXTS = 2048


def _link_volume():
    """Use the network volume's data/ and artifacts/ when present (big training inputs never ship in the image)."""
    for name in ("data", "artifacts"):
        src, dst = VOLUME / name, SRC / name
        if src.exists() and not dst.is_symlink():
            if dst.exists():
                for p in src.iterdir():  # merge: volume files win
                    t = dst / p.name
                    if not t.exists():
                        t.symlink_to(p)
            else:
                dst.symlink_to(src)


def _run(args: list[str], timeout: int = 3600) -> dict:
    p = subprocess.run([sys.executable, *args], cwd=SRC, capture_output=True, text=True, timeout=timeout)
    return {"returncode": p.returncode, "log_tail": (p.stdout + p.stderr)[-4000:]}


def embed(texts: list[str]) -> dict:
    from sentence_transformers import SentenceTransformer
    from forecasting.prompt_encoder import MODEL_ID, MODEL_REVISION
    import torch
    model = SentenceTransformer(MODEL_ID, revision=MODEL_REVISION, device="cuda" if torch.cuda.is_available() else "cpu")
    vecs = model.encode([str(t)[:2000] for t in texts[:MAX_TEXTS]], normalize_embeddings=True, batch_size=256)
    return {"model": MODEL_ID, "dim": int(vecs.shape[1]), "vectors": vecs.round(5).tolist()}


def handler(job: dict) -> dict:
    inp = job.get("input") or {}
    task = inp.get("task", "health")
    if task == "health":
        import torch
        return {"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}
    if task == "embed":
        texts = inp.get("texts") or []
        if not isinstance(texts, list) or not texts:
            return {"error": "texts must be a non-empty list"}
        return embed(texts)
    _link_volume()
    if task == "train_stfkan":
        seeds = [str(int(s)) for s in (inp.get("seeds") or [42, 7, 2026])][:8]
        out = _run(["scripts/train_and_select.py", "--dataset", "onet", "--seeds", *seeds, "--out", "artifacts/onet",
                    "--", "--device", "cuda", "--batch-size", "512", "--lr", "0.003"])
        summary = SRC / "artifacts" / "onet" / "ensemble_report.json"
        out["report"] = json.loads(summary.read_text()) if summary.exists() else None
        return out
    if task == "train_requirements":
        out = _run(["scripts/build_esco_requirements.py"])
        card = SRC / "data" / "snapshots" / "esco_requirements_card.json"
        out["card"] = json.loads(card.read_text()) if card.exists() else None
        return out
    return {"error": f"unknown task: {task}"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
