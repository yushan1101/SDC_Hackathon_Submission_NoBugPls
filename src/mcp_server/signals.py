"""AI-trend signal layer: daily, dated, updatable outside signals -> trend model -> emerging/declining board.

Sources (public, keyless, fetched at most once a day, attribution kept on every item):
  - Hacker News (Algolia search API): weekly story counts per AI topic, last 8 weeks  -> AI advancement attention
  - arXiv API: paper counts per topic, recent 14 days vs prior 42 days           -> research advancement (optional,
    skipped when rate-limited)
  - Arbeitnow + Remotive job-board APIs: share of current postings mentioning each topic -> labour-market demand
Prediction model (transparent, per topic): log-linear trend on weekly counts with a Poisson-noise z-score, Holt
forecast for the next 4 weeks, and a recent-vs-prior rate test for arXiv/jobs; topics map to ESCO occupations by
MiniLM similarity (exposure). Capability topics that rise => emerging roles; automation topics that rise =>
declining pressure on exposed routine roles. All outputs are signals with dates and sources, not certainties.

    python -m mcp_server.signals --refresh      # build today's board (also run daily by the web server)
Retrieved text is DATA: only counts, titles and links are kept; nothing from a source is ever executed.
"""
import argparse
import json
import logging
import math
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from governance.db import no_wait

log = logging.getLogger(__name__)
UA = {"User-Agent": "AiversePulse/0.3 (workforce research; hackathon)"}

# kind: capability (creates demand for people who build/direct it) | automation (pressure on routine work it absorbs)
TOPICS = [
    {"id": "ai-agents", "label": "AI agents & automation workflows", "kind": "capability", "q": "AI agents",
     "kw": [r"\bai agents?\b", r"\bagentic\b"], "skills": ["Systems Analysis", "Judgment and Decision Making", "Programming"],
     "about": "Designing, deploying and supervising autonomous AI agents that run multi-step business workflows."},
    {"id": "llm", "label": "Large language models", "kind": "capability", "q": "LLM",
     "kw": [r"\bllms?\b", r"large language model", r"\bgenai\b", r"generative ai"], "skills": ["Programming", "Writing", "Critical Thinking"],
     "about": "Building products with large language models, prompt design, retrieval and evaluation of generative AI."},
    {"id": "ai-coding", "label": "AI coding assistants", "kind": "automation", "q": "AI coding",
     "kw": [r"copilot", r"ai coding", r"code generation"], "skills": ["Programming", "Quality Control Analysis"],
     "about": "AI tools that write and review software code, changing routine programming and testing work."},
    {"id": "computer-vision", "label": "Computer vision", "kind": "capability", "q": "computer vision",
     "kw": [r"computer vision", r"image recognition"], "skills": ["Programming", "Mathematics"],
     "about": "Cameras and AI models that inspect, recognise and measure objects, used in manufacturing, retail and health."},
    {"id": "robotics", "label": "Robotics & physical AI", "kind": "automation", "q": "robot",
     "kw": [r"robotic", r"\brobots?\b", r"automation engineer"], "skills": ["Operations Monitoring", "Equipment Maintenance", "Troubleshooting"],
     "about": "Robots and automated machines on factory floors, warehouses and logistics handling physical routine tasks."},
    {"id": "autonomous-vehicles", "label": "Autonomous vehicles", "kind": "automation", "q": "self-driving",
     "kw": [r"self[- ]driving", r"autonomous vehicle", r"robotaxi"], "skills": ["Operations Monitoring", "Operation and Control"],
     "about": "Self-driving trucks, taxis and delivery vehicles that change driving, dispatch and transport jobs."},
    {"id": "ai-customer-service", "label": "AI customer service", "kind": "automation", "q": "AI customer support",
     "kw": [r"chatbot", r"conversational ai", r"virtual assistant"], "skills": ["Service Orientation", "Active Listening"],
     "about": "Chatbots and voice assistants answering customer questions, changing call centre and support work."},
    {"id": "ai-healthcare", "label": "AI in healthcare", "kind": "capability", "q": "AI medical",
     "kw": [r"clinical ai", r"medical ai", r"ai in health"], "skills": ["Monitoring", "Critical Thinking", "Reading Comprehension"],
     "about": "AI for diagnosis support, medical imaging, clinical documentation and patient monitoring in hospitals."},
    {"id": "ai-education", "label": "AI in education", "kind": "capability", "q": "AI education",
     "kw": [r"edtech", r"ai tutor", r"learning platform"], "skills": ["Instructing", "Learning Strategies"],
     "about": "AI tutors and adaptive learning tools used by teachers, trainers and learners."},
    {"id": "ai-governance", "label": "AI governance, safety & regulation", "kind": "capability", "q": "AI regulation",
     "kw": [r"ai governance", r"responsible ai", r"ai act", r"model risk"], "skills": ["Judgment and Decision Making", "Systems Evaluation", "Writing"],
     "about": "Policy, compliance, risk and audit of AI systems under new AI laws and standards."},
    {"id": "cybersecurity-ai", "label": "AI cybersecurity", "kind": "capability", "q": "AI security",
     "kw": [r"cyber ?security", r"security analyst", r"threat detection"], "skills": ["Systems Evaluation", "Troubleshooting", "Critical Thinking"],
     "about": "Protecting networks and AI systems, AI-assisted threat detection and incident response."},
    {"id": "data-engineering", "label": "Data engineering for AI", "kind": "capability", "q": "data pipeline",
     "kw": [r"data engineer", r"data pipeline", r"\betl\b", r"data platform"], "skills": ["Programming", "Systems Analysis"],
     "about": "Building data pipelines, warehouses and data quality processes that feed AI models."},
    {"id": "ai-content", "label": "Generative AI for content & design", "kind": "automation", "q": "AI image generation",
     "kw": [r"ai[- ]generated", r"midjourney", r"image generation"], "skills": ["Technology Design", "Writing"],
     "about": "AI that writes copy and generates images, video and designs, changing marketing, media and design work."},
    {"id": "ai-finance", "label": "AI in finance & accounting", "kind": "automation", "q": "AI finance",
     "kw": [r"fintech", r"ai accounting", r"invoice automation"], "skills": ["Mathematics", "Monitoring"],
     "about": "AI that automates bookkeeping, invoice processing, fraud detection and financial analysis."},
    {"id": "green-ai", "label": "AI for energy & climate", "kind": "capability", "q": "AI energy",
     "kw": [r"renewable", r"energy transition", r"climate tech"], "skills": ["Systems Analysis", "Science"],
     "about": "AI for energy grids, renewables, climate modelling and sustainability reporting."},
    {"id": "edge-ai", "label": "On-device & edge AI", "kind": "capability", "q": "on-device AI",
     "kw": [r"edge ai", r"embedded ai", r"on[- ]device"], "skills": ["Programming", "Installation", "Technology Design"],
     "about": "Running AI models on phones, sensors, machines and embedded electronics."},
]


COUNT_UPSERT = ('INSERT INTO signal_counts(day, source, topic, "window", value, n, url, fetched_utc) VALUES(?,?,?,?,?,?,?,?) '
                'ON CONFLICT(day, source, topic, "window") DO UPDATE SET value=excluded.value, n=excluded.n, url=excluded.url, '
                'fetched_utc=excluded.fetched_utc')


def db(path: str | None = None) -> sqlite3.Connection:
    from governance.audit import connect
    con = connect(path)
    if getattr(con, "backend", "sqlite") == "postgres":
        return con
    con.executescript("""
CREATE TABLE IF NOT EXISTS signal_counts(day TEXT, source TEXT, topic TEXT, "window" TEXT, value REAL, n INTEGER,
    url TEXT, fetched_utc TEXT, PRIMARY KEY(day, source, topic, "window"));
CREATE TABLE IF NOT EXISTS signal_boards(day TEXT PRIMARY KEY, board TEXT, created_utc TEXT);""")
    return con


def _get(url: str, params: dict | None = None, timeout: float = 20.0):
    import httpx
    r = httpx.get(url, params=params, headers=UA, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    return r


# ----------------------------------------------------------------------------------- sources
def fetch_hn(today: date, weeks: int = 8) -> dict[str, list[int]]:
    """Weekly HN story counts per topic, oldest -> newest (complete weeks ending today)."""
    out = {}
    end = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    for t in TOPICS:
        counts = []
        for w in range(weeks, 0, -1):
            a, b = end - timedelta(weeks=w), end - timedelta(weeks=w - 1)
            j = _get("https://hn.algolia.com/api/v1/search", {
                "query": t["q"], "tags": "story", "hitsPerPage": 0,
                "numericFilters": f"created_at_i>={int(a.timestamp())},created_at_i<{int(b.timestamp())}"}).json()
            counts.append(int(j.get("nbHits", 0)))
            time.sleep(0.15)
        out[t["id"]] = counts
    return out


def fetch_hn_stories(today: date, per_topic: int = 5) -> list[dict]:
    """This week's most-discussed HN stories per topic (title + link), for the live retrieval index."""
    end = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    out = []
    for t in TOPICS:
        try:
            j = _get("https://hn.algolia.com/api/v1/search", {
                "query": t["q"], "tags": "story", "hitsPerPage": per_topic,
                "numericFilters": f"created_at_i>={int((end - timedelta(days=7)).timestamp())},points>=5"}).json()
        except Exception as e:
            log.warning("HN stories unavailable (%s)", type(e).__name__)
            return out
        for h in j.get("hits", []):
            out.append({"title": h.get("title") or "", "url": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
                        "date": (h.get("created_at") or "")[:10], "points": h.get("points", 0), "topic": t["id"], "source": "hn"})
        time.sleep(0.15)
    return out


def live_passages(day: str, stories: list[dict], posts: list[dict]) -> list[dict]:
    """Today's stories and job postings as dated, linked passages for retrieval (titles + tags only)."""
    seen, out = set(), []
    for s in stories:
        if s["title"] and s["url"] not in seen:
            seen.add(s["url"])
            out.append({"id": f"live:{day}:hn:{len(out)}", "category": "signal", "title": s["title"],
                        "text": f"Hacker News story ({s['points']} points) on {s['topic'].replace('-', ' ')}: {s['title']}",
                        "publisher": "Hacker News", "publication_date": s["date"] or day, "access_date": day, "url": s["url"],
                        "license": "link + title only", "source_id": "hn"})
    for p in posts:
        if p["title"] and p.get("url") and p["url"] not in seen:
            seen.add(p["url"])
            out.append({"id": f"live:{day}:job:{len(out)}", "category": "signal", "title": p["title"],
                        "text": f"Job posting{' at ' + p['company'] if p.get('company') else ''}: {p['text']}",
                        "publisher": p["source"].capitalize(), "publication_date": p["date"] or day, "access_date": day,
                        "url": p["url"], "license": "link + title only", "source_id": p["source"]})
    return out


def fetch_arxiv(today: date) -> dict[str, tuple[int, int]]:
    """(papers in last 14 days, papers in the 42 days before) per topic. Empty dict if arXiv is unavailable."""
    out = {}
    fmt = lambda d: d.strftime("%Y%m%d") + "0000"
    r0, r1, p0 = today - timedelta(days=14), today, today - timedelta(days=56)
    for t in TOPICS:
        q = t["q"].replace('"', "")
        try:
            vals = []
            for a, b in ((r0, r1), (p0, r0)):
                x = _get("https://export.arxiv.org/api/query", {
                    "search_query": f'abs:"{q}" AND submittedDate:[{fmt(a)} TO {fmt(b)}]', "max_results": 0}, timeout=30).text
                m = re.search(r"<opensearch:totalResults[^>]*>(\d+)<", x)
                if not m:
                    raise ValueError("no count")
                vals.append(int(m.group(1)))
                time.sleep(3.2)  # arXiv asks for >= 3 s between requests
            out[t["id"]] = (vals[0], vals[1])
        except Exception as e:
            log.warning("arXiv unavailable (%s); continuing without it", type(e).__name__)
            return {}
    return out


def fetch_jobs(max_pages: int = 4) -> tuple[list[dict], list[str]]:
    """Current postings from Arbeitnow (paged) + Remotive. -> (postings[{title, text, date, source}], sources_ok)."""
    posts, ok = [], []
    try:
        url = "https://www.arbeitnow.com/api/job-board-api"
        for _ in range(max_pages):
            j = _get(url).json()
            for d in j.get("data", []):
                posts.append({"title": d.get("title", ""), "text": " ".join([d.get("title", ""), " ".join(d.get("tags", []))]),
                              "date": datetime.fromtimestamp(d.get("created_at", 0), timezone.utc).date().isoformat(),
                              "source": "arbeitnow", "url": d.get("url", ""), "company": d.get("company_name", "")})
            url = (j.get("links") or {}).get("next")
            if not url:
                break
            time.sleep(1.0)
        ok.append("arbeitnow")
    except Exception as e:
        log.warning("Arbeitnow unavailable (%s)", type(e).__name__)
    try:  # Remotive asks for attribution and at most a few calls a day
        for d in _get("https://remotive.com/api/remote-jobs").json().get("jobs", []):
            posts.append({"title": d.get("title", ""), "text": " ".join([d.get("title", ""), d.get("category", ""), " ".join(d.get("tags", []))]),
                          "date": (d.get("publication_date") or "")[:10], "source": "remotive", "url": d.get("url", ""),
                          "company": d.get("company_name", "")})
        ok.append("remotive")
    except Exception as e:
        log.warning("Remotive unavailable (%s)", type(e).__name__)
    return posts, ok


# ----------------------------------------------------------------------------------- trend model
def loglinear_trend(counts: list[int]) -> dict:
    """Weighted LS slope of log(count+0.5) on week index (weights ~ counts, Poisson variance), with z-score,
    weekly growth %, and a Holt (double exponential) 4-week forecast."""
    y = np.log(np.asarray(counts, float) + 0.5)
    x = np.arange(len(y), dtype=float)
    w = np.asarray(counts, float) + 0.5
    xm, ym = np.average(x, weights=w), np.average(y, weights=w)
    sxx = np.sum(w * (x - xm) ** 2)
    slope = float(np.sum(w * (x - xm) * (y - ym)) / sxx) if sxx > 0 else 0.0
    resid = y - (ym + slope * (x - xm))
    s2 = max(float(np.sum(w * resid ** 2) / max(len(y) - 2, 1)), 1e-9)
    se = math.sqrt(s2 / sxx) if sxx > 0 else float("inf")
    level, trend = float(counts[0]), 0.0
    for c in counts[1:]:  # Holt: alpha .5, beta .3
        prev = level
        level = 0.5 * c + 0.5 * (level + trend)
        trend = 0.3 * (level - prev) + 0.7 * trend
    forecast = [max(0.0, level + (h + 1) * trend) for h in range(4)]
    return {"slope": slope, "z": slope / se if se > 0 else 0.0, "weekly_growth_pct": (math.exp(slope) - 1) * 100,
            "forecast_4w": [round(f, 1) for f in forecast]}


def rate_test(recent: float, n_recent_days: int, prior: float, n_prior_days: int) -> float:
    """z-score of recent vs prior daily rate under Poisson noise (positive = rising)."""
    r1, r0 = recent / n_recent_days, prior / n_prior_days
    pooled = (recent + prior) / (n_recent_days + n_prior_days)
    se = math.sqrt(max(pooled, 1e-9) * (1 / n_recent_days + 1 / n_prior_days))
    return (r1 - r0) / se


def _direction(z: float) -> str:
    return "rising" if z >= 2 else "falling" if z <= -2 else "stable"


# ----------------------------------------------------------------------------------- exposure (topic -> occupations)
@lru_cache(maxsize=1)
def _exposure() -> np.ndarray:
    """(n_topics, n_occupations) cosine similarity between topic descriptions and ESCO occupations (MiniLM)."""
    from agents.matcher import occupation_vectors
    from mcp_server.retrieval import _embed
    _, b = occupation_vectors()
    a = np.asarray(_embed([f"{t['label']}. {t['about']}" for t in TOPICS]), np.float32)
    return a @ b.T


def build_board(today: date, hn: dict, arxiv: dict, jobs: list[dict], job_sources: list[str], history: dict) -> dict:
    from agents.knowledge import snapshot
    occ = snapshot()["occupations"]
    socs = list(occ)
    day = today.isoformat()
    topics, ev = [], []
    for t in TOPICS:
        parts, z_list = {}, []
        if t["id"] in hn:
            tr = loglinear_trend(hn[t["id"]])
            parts["hn"] = {"weekly": hn[t["id"]], **tr}
            z_list.append(max(-6, min(6, tr["z"])))
            ev.append({"id": f"signal:{day}:{t['id']}:hn", "category": "signal", "publication_date": day,
                       "title": f"Hacker News stories on {t['label']} (8 weeks to {day})", "publisher": "Hacker News via Algolia",
                       "url": "https://hn.algolia.com/?type=story&dateRange=pastMonth&query=" + t["q"].replace(" ", "%20"),
                       "excerpt": f"Weekly stories: {', '.join(map(str, hn[t['id']]))}; trend {tr['weekly_growth_pct']:+.1f}%/week (z {tr['z']:+.1f})."})
        if t["id"] in arxiv:
            r, p = arxiv[t["id"]]
            z = rate_test(r, 14, p, 42)
            parts["arxiv"] = {"recent_14d": r, "prior_42d": p, "z": z}
            z_list.append(max(-6, min(6, z)))
            ev.append({"id": f"signal:{day}:{t['id']}:arxiv", "category": "signal", "publication_date": day,
                       "title": f"arXiv papers on {t['label']} (last 14 vs prior 42 days)", "publisher": "arXiv",
                       "url": "https://arxiv.org/search/advanced", "excerpt": f"{r} papers in 14 days vs {p} in the 42 days before (z {z:+.1f})."})
        if jobs:
            rx = re.compile("|".join(t["kw"]), re.I)
            hits = sum(bool(rx.search(j["text"])) for j in jobs)
            share = hits / len(jobs)
            parts["jobs"] = {"postings": len(jobs), "mentions": hits, "share": round(share, 4)}
            prior = history.get(t["id"], [])
            if len(prior) >= 5:  # job-share trend only once a week of daily history exists
                z = (share - float(np.mean(prior))) / max(float(np.std(prior)), math.sqrt(max(share, 1e-4) / len(jobs)))
                parts["jobs"]["z"] = z
                z_list.append(max(-6, min(6, z)))
            ev.append({"id": f"signal:{day}:{t['id']}:jobs", "category": "signal", "publication_date": day,
                       "title": f"Job postings mentioning {t['label']} ({day})", "publisher": " + ".join(job_sources),
                       "url": "https://www.arbeitnow.com" if "arbeitnow" in job_sources else "https://remotive.com",
                       "excerpt": f"{hits} of {len(jobs)} current postings ({share:.1%}) mention it"
                                  + (f"; vs {np.mean(prior):.1%} average over the last {len(prior)} days." if len(prior) >= 5 else "; trend needs 5+ days of history.")})
        z = float(np.mean(z_list)) if z_list else 0.0
        agree = sum(1 for v in z_list if (v >= 2) == (z >= 2) and abs(v) >= 1)
        topics.append({"id": t["id"], "label": t["label"], "kind": t["kind"], "skills": t["skills"], "z": round(z, 2),
                       "direction": _direction(z), "confidence": "high" if len(z_list) >= 2 and agree >= 2 else "medium" if abs(z) >= 2 else "low",
                       "sources": parts, "evidence_ids": [e["id"] for e in ev if f":{t['id']}:" in e["id"]]})

    # roles: exposure-weighted momentum; capability topics -> emergence, automation topics -> decline pressure
    E = _exposure()
    E = (E - E.mean(1, keepdims=True)) / (E.std(1, keepdims=True) + 1e-9)  # relative exposure per topic
    E = np.clip(E, 0, None)
    zc = np.array([tp["z"] if tp["kind"] == "capability" else 0.0 for tp in topics])
    za = np.array([tp["z"] if tp["kind"] == "automation" else 0.0 for tp in topics])
    emerge = np.clip(zc, 0, None) @ E - 0.5 * np.clip(za, 0, None) @ E
    pressure = np.clip(za, 0, None) @ E
    def role(i, score, key):
        drivers = sorted(range(len(TOPICS)), key=lambda k: -E[k, i] * abs(topics[k]["z"]))[:2]
        return {"soc": socs[i], "title": occ[socs[i]]["title"], key: round(float(score[i]), 2),
                "drivers": [topics[k]["id"] for k in drivers]}
    emerging = [role(i, emerge, "score") for i in np.argsort(-emerge)[:12] if emerge[i] > 0]
    declining = [role(i, pressure, "pressure") for i in np.argsort(-pressure)[:12] if pressure[i] > 0]
    per_occ = {socs[i]: {"emergence": round(float(emerge[i]), 2), "pressure": round(float(pressure[i]), 2),
                         "topics": [topics[k]["id"] for k in np.argsort(-E[:, i])[:3] if E[k, i] > 0.5]} for i in range(len(socs))}
    return {"day": day, "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sources": {"hn": bool(hn), "arxiv": bool(arxiv), "jobs": job_sources, "postings": len(jobs)},
            "method": "log-linear weekly trend + Poisson z (HN), recent-vs-prior rate test (arXiv), daily share vs history "
                      "(job boards); MiniLM topic->occupation exposure. Signals, not certainties.",
            "topics": sorted(topics, key=lambda t: -t["z"]), "emerging_roles": emerging, "declining_roles": declining,
            "occupations": per_occ, "evidence": ev}


def refresh(today: date | None = None, con=None, sources=("hn", "arxiv", "jobs")) -> dict:
    today = today or datetime.now(timezone.utc).date()
    con = con or db()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hn = fetch_hn(today) if "hn" in sources else {}
    arxiv = fetch_arxiv(today) if "arxiv" in sources else {}
    jobs, job_sources = fetch_jobs() if "jobs" in sources else ([], [])
    stories = fetch_hn_stories(today) if "hn" in sources else []
    day = today.isoformat()
    with con:
        for tid, counts in hn.items():
            for k, c in enumerate(counts):
                con.execute(COUNT_UPSERT,
                            (day, "hn", tid, f"week-{len(counts) - k}", c, c, "https://hn.algolia.com", now))
        for tid, (r, p) in arxiv.items():
            con.execute(COUNT_UPSERT, (day, "arxiv", tid, "14d", r, r, "https://arxiv.org", now))
        no_wait(con)  # fetched counts: re-fetchable, no need to wait for the standby
    history = {}
    for t in TOPICS:
        rows = con.execute("SELECT value FROM signal_counts WHERE source='jobs' AND topic=? AND day<? ORDER BY day DESC LIMIT 28",
                           (t["id"], day)).fetchall()
        history[t["id"]] = [r[0] for r in rows]
    board = build_board(today, hn, arxiv, jobs, job_sources, history)
    with con:
        for tp in board["topics"]:
            if "jobs" in tp["sources"]:
                con.execute(COUNT_UPSERT,
                            (day, "jobs", tp["id"], "day", tp["sources"]["jobs"]["share"], tp["sources"]["jobs"]["mentions"],
                             "https://www.arbeitnow.com", now))
        con.execute("INSERT INTO signal_boards(day, board, created_utc) VALUES(?,?,?) "
                    "ON CONFLICT(day) DO UPDATE SET board=excluded.board, created_utc=excluded.created_utc", (day, json.dumps(board), now))
        no_wait(con)
    try:  # real-time RAG: today's postings and stories replace yesterday's in the live vector collection
        from mcp_server import retrieval
        board["live_indexed"] = retrieval.index_live(live_passages(day, stories, jobs))
    except Exception as e:
        log.warning("live index not updated (%s)", type(e).__name__)
    return board


def latest_board(con=None, day: str | None = None) -> dict | None:
    con = con or db()
    row = con.execute("SELECT board FROM signal_boards WHERE day<=? ORDER BY day DESC LIMIT 1",
                      (day or "9999-12-31",)).fetchone()
    return json.loads(row[0]) if row else None


def history_days(con=None, limit: int = 30) -> list[str]:
    con = con or db()
    return [r[0] for r in con.execute("SELECT day FROM signal_boards ORDER BY day DESC LIMIT ?", (limit,))]


def seeded_history() -> list[dict]:
    """Small, read-only historical comparison snapshots bundled with the app."""
    path = Path(__file__).resolve().parent.parent / "data" / "signal_history_seed.json"
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--sources", default="hn,arxiv,jobs")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    if a.refresh:
        b = refresh(sources=tuple(a.sources.split(",")))
        print(json.dumps({"day": b["day"], "sources": b["sources"],
                          "top": [(t["id"], t["direction"], t["z"]) for t in b["topics"][:6]],
                          "emerging": [r["title"] for r in b["emerging_roles"][:5]],
                          "declining": [r["title"] for r in b["declining_roles"][:5]]}, indent=1))


if __name__ == "__main__":
    main()
