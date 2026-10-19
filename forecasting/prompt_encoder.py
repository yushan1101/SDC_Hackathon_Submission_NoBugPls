"""Frozen MiniLM embeddings of cutoff-safe role/skill prompts, cached to disk.

Prompts contain only role and skill names (no dated text), so they are safe for a 2023 backtest.
Returns None when sentence-transformers is not installed; the model then uses learned ID embeddings.
"""
from pathlib import Path

import numpy as np

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"  # pinned HF commit (Apache-2.0)


def prompt(role: str, skill: str, geography: str = "global") -> str:
    return f"Job role: {role}. Skill required in job postings: {skill}. Job market: {geography}."


def encode(texts: list[str], cache: Path = Path("artifacts/embeddings.npz")):
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        if list(z["texts"]) == texts:
            return z["emb"]
    try:
        import sentence_transformers  # noqa: F401
    except ImportError:
        return None
    from mcp_server.retrieval import _encoder
    emb = _encoder().encode(texts, normalize_embeddings=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, texts=np.array(texts), emb=emb)
    return emb
