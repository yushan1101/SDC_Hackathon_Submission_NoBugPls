"""Future-role matching: rank every O*NET occupation for a person (any job, no target needed).

skill_fit = F1 of (coverage: how much of the role's importance-weighted requirements the person meets,
                   alignment: how important the person's strongest skills are to this role)  + tool-overlap bonus
text_fit  = MiniLM similarity between the person's own words (resume / summary) and the occupation (optional)
fit       = skill_fit, or 0.55 * skill_fit + 0.45 * text_fit_rescaled when text is given
score     = fit * (1 + 0.15 * clip(emergence, -1, 2) - 0.10 * clip(pressure, 0, 2))   (ranking only, from the daily board)
"""
from functools import lru_cache
from pathlib import Path

import numpy as np

from agents.knowledge import snapshot

FUTURE_WEIGHT, PRESSURE_WEIGHT, TOOL_BONUS, STRETCH = 0.15, 0.10, 0.06, 0.85
VECS = Path(__file__).resolve().parents[1] / "data" / "snapshots" / "occupation_vectors.npz"


def occupation_text(o: dict) -> str:
    return f"{o['title']}. {o['description']} {' '.join(o['tasks'][:3])}"


@lru_cache(maxsize=1)
def occupation_vectors() -> tuple[list[str], np.ndarray]:
    """MiniLM vectors for every occupation (cached on disk; rebuilt if the occupation list changes)."""
    occ = snapshot()["occupations"]
    socs = list(occ)
    if VECS.exists():
        z = np.load(VECS, allow_pickle=False)
        if list(z["socs"]) == socs:
            return socs, z["vecs"].astype(np.float32)
    from mcp_server.retrieval import _embed
    vecs = np.asarray(_embed([occupation_text(occ[s]) for s in socs]), np.float32)
    np.savez_compressed(VECS, socs=np.array(socs), vecs=vecs.astype(np.float16))
    return socs, vecs


def _text_fit(text: str) -> dict[str, float]:
    from mcp_server.retrieval import _embed
    socs, vecs = occupation_vectors()
    sim = vecs @ np.asarray(_embed([text[:2000]])[0], np.float32)
    lo, hi = float(np.percentile(sim, 50)), float(sim.max()) or 1.0
    return {s: float(np.clip((v - lo) / max(hi - lo, 1e-6), 0, 1)) for s, v in zip(socs, sim)}


def fit_for(levels: dict[str, int], soc: str, text: str | None = None, board: dict | None = None) -> dict | None:
    """Fit of one person to one occupation (same formula as match_roles)."""
    if soc not in snapshot()["occupations"]:
        return None
    return _score(soc, {k.lower(): v for k, v in levels.items() if v > 0}, (board or {}).get("occupations", {}),
                  _text_fit(text) if text else None)


def match_roles(levels: dict[str, int], top_k: int = 8, board: dict | None = None, text: str | None = None,
                soc_prefixes: list[str] | None = None, max_zone: int | None = None) -> list[dict]:
    """max_zone: the person's O*NET Job Zone (preparation level). Roles more than one zone above are skipped;
    one zone above are kept as a 'stretch' with a small ranking penalty."""
    have = {k.lower(): v for k, v in levels.items() if v > 0}
    per_occ = (board or {}).get("occupations", {})
    tf = _text_fit(text) if text else None
    occ = snapshot()["occupations"]
    out = []
    for soc in occ:
        zone = occ[soc].get("job_zone") or 3
        if (soc_prefixes and not any(soc.startswith(p) for p in soc_prefixes)) or (max_zone and zone > max_zone + 1):
            continue
        r = _score(soc, have, per_occ, tf)
        r["stretch"] = bool(max_zone and zone > max_zone)
        r["score"] = round(r["score"] * (STRETCH if r["stretch"] else 1.0), 3)
        out.append(r)
    return sorted(out, key=lambda r: -r["score"])[:top_k]


def _score(soc: str, have: dict, per_occ: dict, tf: dict | None) -> dict:
    o = snapshot()["occupations"][soc]
    total = sum(have.values()) or 1
    w = np.array([s["importance"] for s in o["skills"].values()])
    req = np.array([max(s["required"], 1) for s in o["skills"].values()], float)
    cur = np.array([min(have.get(n.lower(), 0), r) for n, r in zip(o["skills"], req)], float)
    coverage = float((w * cur).sum() / (w * req).sum())
    imp = {n.lower(): s["importance"] for n, s in o["skills"].items()}
    alignment = sum(v * imp.get(k, 0.0) for k, v in have.items()) / (5.0 * total)  # weighted toward the person's strongest skills
    skill_fit = 0.0 if coverage + alignment == 0 else 2 * coverage * alignment / (coverage + alignment)
    tools = [t["name"].lower() for t in o["tech"]]
    tool_hit = sum(t in have for t in tools)
    skill_fit = min(1.0, skill_fit + TOOL_BONUS * tool_hit)
    fit = 0.55 * skill_fit + 0.45 * tf[soc] if tf else skill_fit
    sig = per_occ.get(soc, {})
    em, pr = float(sig.get("emergence", 0.0)), float(sig.get("pressure", 0.0))
    score = fit * (1 + FUTURE_WEIGHT * np.clip(em, -1, 2) - PRESSURE_WEIGHT * np.clip(pr, 0, 2))
    gaps = sorted(((n, s["required"] - have.get(n.lower(), 0)) for n, s in o["skills"].items()
                   if s["required"] > have.get(n.lower(), 0)), key=lambda x: -x[1] * o["skills"][x[0]]["importance"])
    return {"soc": soc, "title": o["title"], "fit": round(fit, 3), "score": round(float(score), 3),
            "coverage": round(coverage, 3), "tools_matched": tool_hit, "emergence": em, "pressure": pr,
            "job_zone": o.get("job_zone"), "top_gaps": [g for g, _ in gaps[:3]],
            "gap_levels": int(sum(d for _, d in gaps))}
