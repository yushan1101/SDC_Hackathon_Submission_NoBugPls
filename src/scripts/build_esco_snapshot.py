"""Build the live occupation/skill snapshot from the public ESCO API (European Commission, v1.2).

    python scripts/build_esco_snapshot.py            # ~3,000 occupations, ~10 min, polite (6 threads)

Writes data/snapshots/esco_raw.json: {meta, occupations: {id: {title, isco, description, alt, essential[], optional[]}},
skills: {id: {title, type}}}. Skill levels/importance are added later by scripts/build_esco_requirements.py using
a model trained on O*NET (O*NET itself is never read at runtime).
ESCO is free to reuse with attribution: "ESCO, European Commission" (https://esco.ec.europa.eu).
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import httpx
import os
os.chdir(Path(__file__).resolve().parents[1])  # data/ paths below are relative to src/

API = "https://ec.europa.eu/esco/api"
OUT = Path("data/snapshots/esco_raw.json")
UA = {"User-Agent": "AiversePulse/0.4 (workforce research; hackathon)"}


def get(client, path, params, tries=4):
    for k in range(tries):
        try:
            r = client.get(f"{API}/{path}", params=params, timeout=40)
            if r.status_code == 200:
                return r.json()
        except httpx.HTTPError:
            pass
        time.sleep(1.5 * (k + 1))
    return None


def short_id(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def main():
    with httpx.Client(headers=UA) as c:
        uris, off = [], 0
        while True:
            d = get(c, "search", {"type": "occupation", "language": "en", "limit": 100, "offset": off, "full": "false"})
            res = (d or {}).get("_embedded", {}).get("results", [])
            if not res:
                break
            uris += [r["uri"] for r in res]
            off += 1  # ESCO offset is a page index
        print(len(uris), "occupation URIs")

        def one(uri):
            d = get(c, "resource/occupation", {"uri": uri, "language": "en"})
            if not d:
                return None
            L = d.get("_links", {})
            desc = (d.get("description") or {}).get("en", {}).get("literal", "")
            sk = lambda key: [{"id": short_id(s["uri"]), "title": s["title"],
                               "type": s.get("skillType", "").rsplit("/", 1)[-1]} for s in L.get(key, [])]
            return short_id(uri), {"title": d.get("title") or d["preferredLabel"]["en"], "code": d.get("code", ""),
                                   "isco": (d.get("code") or "").split(".")[0], "description": desc,
                                   "alt": (d.get("alternativeLabel") or {}).get("en", [])[:25],
                                   "essential": sk("hasEssentialSkill"), "optional": sk("hasOptionalSkill")}

        occ, skills = {}, {}
        with ThreadPoolExecutor(6) as pool:
            for i, r in enumerate(pool.map(one, uris)):
                if r:
                    oid, o = r
                    for s in o["essential"] + o["optional"]:
                        skills[s["id"]] = {"title": s["title"], "type": s["type"]}
                    o["essential"] = [s["id"] for s in o["essential"]]
                    o["optional"] = [s["id"] for s in o["optional"]]
                    occ[oid] = o
                if i % 250 == 0:
                    print(i, len(occ))
    OUT.write_text(json.dumps({"meta": {"source": "ESCO v1.2, European Commission", "url": "https://esco.ec.europa.eu",
                                        "license": "Free reuse with attribution (Commission Decision 2011/833/EU)",
                                        "fetched": date.today().isoformat()},
                               "occupations": occ, "skills": skills}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(occ)} occupations, {len(skills)} skills -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
