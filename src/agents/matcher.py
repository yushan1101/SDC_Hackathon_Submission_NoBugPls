"""Future-role matching: rank every ESCO occupation for a person (any job, no target needed).

Skills are aligned semantically to ESCO's vocabulary (agents/skillmap.py), once per request:
credit[skill] = level of the person's most similar skill (cosine >= MATCH; one level less for >= PARTIAL).
skill_fit = F1 of (coverage: share of the role's importance-weighted required levels the person meets,
                   alignment: how important the person's strongest skills are to this role)  + tool-overlap bonus
text_fit  = MiniLM similarity between the person's own words (resume / summary) and the occupation (optional)
fit       = skill_fit, or 0.55 * skill_fit + 0.45 * text_fit_rescaled when text is given
score     = fit * (1 + 0.15 * clip(emergence, -1, 2) - 0.10 * clip(pressure, 0, 2))   (ranking only, from the daily board)
Importance and required levels are model predictions (trained offline on O*NET ratings); O*NET is not read here.
"""
from functools import lru_cache
from pathlib import Path

import numpy as np

from agents.knowledge import snapshot
from agents.skillmap import MATCH, PARTIAL, vectors, vocabulary

FUTURE_WEIGHT, PRESSURE_WEIGHT, TOOL_BONUS, STRETCH = 0.15, 0.10, 0.06, 0.85
VECS = Path(__file__).resolve().parents[1] / "data" / "snapshots" / "occupation_vectors.npz"


def occupation_text(o: dict) -> str:
    return f"{o['title']}. {o['description']}"


@lru_cache(maxsize=1)
def occupation_vectors() -> tuple[list[str], np.ndarray]:
    """MiniLM vectors for every occupation (cached on disk; rebuilt if the occupation list changes)."""
    occ = snapshot()["occupations"]
    socs = list(occ)
    if VECS.exists():
        z = np.load(VECS, allow_pickle=False)
        if list(z["socs"]) == socs:
            return socs, z["vecs"].astype(np.float32)
    from agents.skillmap import encode
    vecs = encode([occupation_text(occ[s]) for s in socs])
    np.savez_compressed(VECS, socs=np.array(socs), vecs=vecs.astype(np.float16))
    return socs, vecs


@lru_cache(maxsize=1)
def _occ_index() -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]]:
    """occupation -> (vocab indices, importance, required, is_tool) arrays."""
    names, _ = vocabulary()
    pos = {n: i for i, n in enumerate(names)}
    out = {}
    for soc, o in snapshot()["occupations"].items():
        tools = {t["name"] for t in o["tech"]}
        items = list(o["skills"].items())
        out[soc] = (np.array([pos[n] for n, _ in items]), np.array([d["importance"] for _, d in items], float),
                    np.array([max(d["required"], 1) for _, d in items], float), np.array([n in tools for n, _ in items]))
    return out


def _credit(have: dict[str, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """-> (credited level per vocab skill, user-x-vocab similarity, user levels)."""
    names, V = vocabulary()
    keys = list(have)
    S = vectors(keys) @ V.T if keys else np.zeros((0, len(names)), np.float32)
    lv = np.array([have[k] for k in keys], float)
    if not keys:
        return np.zeros(len(names)), S, lv
    best = S.argmax(0)
    sim = S[best, np.arange(len(names))]
    credit = np.where(sim >= MATCH, lv[best], np.where((sim >= PARTIAL) & (lv[best] > 1), lv[best] - 1, 0))
    return credit, S, lv


def _text_fit(text: str) -> dict[str, float]:
    from agents.skillmap import encode
    socs, vecs = occupation_vectors()
    sim = vecs @ encode([text[:2000]])[0]
    lo, hi = float(np.percentile(sim, 50)), float(sim.max()) or 1.0
    return {s: float(np.clip((v - lo) / max(hi - lo, 1e-6), 0, 1)) for s, v in zip(socs, sim)}


def _prep(levels):
    return {k: v for k, v in levels.items() if v > 0}


def fit_for(levels: dict[str, int], soc: str, text: str | None = None, board: dict | None = None) -> dict | None:
    """Fit of one person to one occupation (same formula as match_roles)."""
    if soc not in snapshot()["occupations"]:
        return None
    return _score(soc, *_credit(_prep(levels)), (board or {}).get("occupations", {}), _text_fit(text) if text else None)


def match_roles(levels: dict[str, int], top_k: int = 8, board: dict | None = None, text: str | None = None,
                soc_prefixes: list[str] | None = None, max_zone: int | None = None) -> list[dict]:
    """soc_prefixes: ISCO-08 code prefixes (field filter). max_zone: the person's ISCO skill level (1-4);
    roles more than one level above are skipped, one level above are kept as a 'stretch' with a ranking penalty."""
    credit, S, lv = _credit(_prep(levels))
    per_occ = (board or {}).get("occupations", {})
    tf = _text_fit(text) if text else None
    occ = snapshot()["occupations"]
    out = []
    for soc in occ:
        zone = occ[soc].get("job_zone") or 2
        if (soc_prefixes and not any(soc.startswith(p) for p in soc_prefixes)) or (max_zone and zone > max_zone + 1):
            continue
        r = _score(soc, credit, S, lv, per_occ, tf)
        r["stretch"] = bool(max_zone and zone > max_zone)
        r["score"] = round(r["score"] * (STRETCH if r["stretch"] else 1.0), 3)
        out.append(r)
    return sorted(out, key=lambda r: -r["score"])[:top_k]


def _score(soc: str, credit: np.ndarray, S: np.ndarray, lv: np.ndarray, per_occ: dict, tf: dict | None) -> dict:
    o = snapshot()["occupations"][soc]
    idx, w, req, is_tool = _occ_index()[soc]
    cur = np.minimum(credit[idx], req)
    coverage = float((w * cur).sum() / max((w * req).sum(), 1e-9))
    if len(lv):  # each of the person's skills: the importance this role gives its closest requirement
        best_imp = np.where(S[:, idx] >= MATCH, w[None, :], 0).max(1)
        alignment = float((lv * best_imp).sum() / (5.0 * lv.sum()))
    else:
        alignment = 0.0
    skill_fit = 0.0 if coverage + alignment == 0 else 2 * coverage * alignment / (coverage + alignment)
    tool_hit = int((is_tool & (credit[idx] > 0)).sum())
    skill_fit = min(1.0, skill_fit + TOOL_BONUS * tool_hit)
    fit = 0.55 * skill_fit + 0.45 * tf[soc] if tf else skill_fit
    sig = per_occ.get(soc, {})
    em, pr = float(sig.get("emergence", 0.0)), float(sig.get("pressure", 0.0))
    score = fit * (1 + FUTURE_WEIGHT * np.clip(em, -1, 2) - PRESSURE_WEIGHT * np.clip(pr, 0, 2))
    names = list(o["skills"])
    gap = req - cur
    order = np.argsort(-(gap * w))
    return {"soc": soc, "title": o["title"], "fit": round(fit, 3), "score": round(float(score), 3),
            "coverage": round(coverage, 3), "tools_matched": tool_hit, "emergence": em, "pressure": pr,
            "job_zone": o.get("job_zone"), "isco": o.get("isco"),
            "top_gaps": [names[i] for i in order[:3] if gap[i] > 0], "gap_levels": int(gap.sum())}
