"""SDG mapping lookups (all 17 goals) for occupations and skills, with official target text as evidence."""
import json
from functools import lru_cache
from pathlib import Path

from core.state import Evidence

MAP = Path(__file__).resolve().parents[1] / "data" / "snapshots" / "sdg_map.json"
BASELINE = ["SDG4", "SDG8"]  # every reskilling pathway serves quality education + decent work


@lru_cache(maxsize=1)
def sdg_map() -> dict:
    return json.loads(MAP.read_text(encoding="utf-8")) if MAP.exists() else {"goals": [], "occupations": {}, "skills": {}}


def goal_meta(n: int) -> dict:
    g = sdg_map()["goals"]
    return g[n - 1] if 0 < n <= len(g) else {"goal": n, "short": f"SDG {n}", "color": "#888", "url": "https://sdgs.un.org/goals"}


TOP_MIN, NEXT_MIN, NEXT_Z = 0.15, 0.20, 1.2  # cosine floors: weaker matches were noise in spot checks
DECENT_WORK = {"goal": 8, "score": None, "z": None, "target": "8.5", "baseline": True,
               "target_text": "By 2030, achieve full and productive employment and decent work for all women and men, "
                              "including for young people and persons with disabilities, and equal pay for work of equal value"}


def _evidence(key: str, x: dict) -> Evidence:
    m = goal_meta(x["goal"])
    how = "baseline: every job counts toward decent work" if x.get("baseline") else f"semantic match {x['score']:.2f}"
    return Evidence(id=f"sdg:{key}:{x['goal']}", title=f"SDG {x['goal']} {m['short']} — target {x['target']}",
                    publication_date="UN SDG API (2015 targets)", url=m["url"], publisher="United Nations",
                    category="sdg", license="UN public information",
                    excerpt=f"Target {x['target']}: {x['target_text']} ({how}; not an official UN classification)")


def confident(items: list[dict]) -> list[dict]:
    keep = [x for i, x in enumerate(items)
            if (i == 0 and x["score"] >= TOP_MIN) or (i > 0 and x["score"] >= NEXT_MIN and x["z"] >= NEXT_Z)]
    return keep or [DECENT_WORK]


def role_sdgs(soc: str) -> tuple[list[dict], list[Evidence]]:
    items = confident(sdg_map()["occupations"].get(soc, []))
    return items, [_evidence(soc, x) for x in items]


def skill_sdgs(skill: str) -> list[dict]:
    return sdg_map()["skills"].get(skill, {}).get("sdgs", [])


def links_for(skill: str) -> list[str]:
    """SDG tags for a pathway activity: the baseline goals plus the skill's strongest mapped goal."""
    extra = [f"SDG{x['goal']}" for x in skill_sdgs(skill)[:1]]
    return list(dict.fromkeys(BASELINE + extra))
