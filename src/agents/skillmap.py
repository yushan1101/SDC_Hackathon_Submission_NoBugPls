"""Semantic skill alignment over the ESCO vocabulary (MiniLM cosine), used by every agent that compares skills.

ESCO skills are phrases ("listen actively", "administer medication"), so people's words rarely match exactly.
align() credits a requirement with the level of the person's most similar skill when the similarity clears a
threshold; exact (case-insensitive) matches always count. Vectors for the whole vocabulary are cached on disk.
"""
from functools import lru_cache
from pathlib import Path

import numpy as np

from agents.knowledge import snapshot

VECS = Path(__file__).resolve().parents[1] / "data" / "snapshots" / "esco_skill_vectors.npz"
MATCH = 0.62     # cosine at/above which two skill phrases count as the same capability
PARTIAL = 0.50   # related capability: credited one level lower


@lru_cache(maxsize=1)
def vocabulary() -> tuple[list[str], np.ndarray]:
    names = sorted({n for o in snapshot()["occupations"].values() for n in o["skills"]})
    if VECS.exists():
        z = np.load(VECS, allow_pickle=False)
        if len(z["names"]) == len(names) and list(z["names"]) == names:
            return names, z["vecs"].astype(np.float32)
    vecs = encode(names)
    np.savez_compressed(VECS, names=np.array(names), vecs=vecs.astype(np.float16))
    return names, vecs


@lru_cache(maxsize=1)
def _index() -> dict[str, int]:
    return {n.lower(): i for i, n in enumerate(vocabulary()[0])}


def encode(texts: list[str]) -> np.ndarray:
    from mcp_server.retrieval import _embed
    out = []
    for i in range(0, len(texts), 512):
        out += _embed(texts[i:i + 512])
    return np.asarray(out, np.float32).reshape(len(texts), -1)


def vectors(names: list[str]) -> np.ndarray:
    """Vocabulary vectors where known, fresh encodings for anything else."""
    names_, V = vocabulary()
    idx = _index()
    missing = [n for n in names if n.lower() not in idx]
    fresh = dict(zip(missing, encode(missing))) if missing else {}
    return np.stack([V[idx[n.lower()]] if n.lower() in idx else fresh[n] for n in names]) if names else np.zeros((0, V.shape[1]), np.float32)


def align(levels: dict[str, int], targets: list[str]) -> dict[str, tuple[int, str, float]]:
    """-> {target: (credited level, person's skill it came from, similarity)} for targets the person covers."""
    have = {k: v for k, v in levels.items() if v > 0}
    if not have or not targets:
        return {}
    hk = list(have)
    S = vectors(targets) @ vectors(hk).T
    out = {}
    low = {k.lower(): k for k in hk}
    for i, t in enumerate(targets):
        if t.lower() in low:
            k = low[t.lower()]
            out[t] = (have[k], k, 1.0)
            continue
        j = int(S[i].argmax())
        sim, lvl = float(S[i, j]), have[hk[j]]
        if sim >= MATCH:
            out[t] = (lvl, hk[j], round(sim, 3))
        elif sim >= PARTIAL and lvl > 1:
            out[t] = (lvl - 1, hk[j], round(sim, 3))
    return out


def nearest(phrase: str, k: int = 1, floor: float = PARTIAL) -> list[tuple[str, float]]:
    """Closest ESCO skill labels to free text (for parsing HR criteria and typed skills)."""
    names, V = vocabulary()
    s = V @ encode([phrase])[0]
    top = np.argsort(-s)[:k]
    return [(names[i], round(float(s[i]), 3)) for i in top if s[i] >= floor]
