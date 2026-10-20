"""Build attributed knowledge passages + vector index for the LIVE agents (every O*NET occupation).

Sources (public, attribution kept on every passage):
  - O*NET 31.0 database (Aug 2026, CC BY 4.0): occupation descriptions and core tasks for all rated
    occupations (data/snapshots/onet_occupations.json, built by scripts/build_onet_snapshot.py).
  - O*NET OnLine skill pages (definition + where each skill is used) for the 35 O*NET skills.
  - Official vendor/project docs for common tools (URLs checked at ingest time; dead links dropped).
The 2023 job-ad dataset is deliberately NOT ingested: it is training data for the forecasting model only.

    python -m mcp_server.ingest            # (re)build passages + Chroma index
    python -m mcp_server.ingest --index-only
"""
import argparse
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PASSAGES = ROOT / "data" / "snapshots" / "knowledge_passages.json"
SNAPSHOT = ROOT / "data" / "snapshots" / "onet_occupations.json"
ONET_VERSION, ONET_DATE = "31.0", "2026-08"
ONET_LICENSE = "CC BY 4.0 (O*NET 31.0 Database, U.S. Department of Labor/ETA)"
ONET_BASE = dict(source_id=f"onet:{ONET_VERSION}", publisher="O*NET Resource Center (USDOL/ETA)",
                 publication_date=ONET_DATE, license=ONET_LICENSE, jurisdiction="US")

LEARNING = {  # official documentation / vendor training only
    "python": ("Python Tutorial (Python Software Foundation)", "https://docs.python.org/3/tutorial/"),
    "sql": ("PostgreSQL Tutorial (PostgreSQL Global Development Group)", "https://www.postgresql.org/docs/current/tutorial.html"),
    "sql server": ("SQL Server documentation (Microsoft Learn)", "https://learn.microsoft.com/en-us/sql/sql-server/"),
    "excel": ("Excel help & learning (Microsoft Support)", "https://support.microsoft.com/en-us/excel"),
    "power bi": ("Power BI training (Microsoft Learn)", "https://learn.microsoft.com/en-us/training/powerplatform/power-bi"),
    "tableau": ("Get Started with Tableau Desktop (Tableau Help)", "https://help.tableau.com/current/guides/get-started-tutorial/en-us/get-started-tutorial-home.htm"),
    "r": ("An Introduction to R (CRAN manuals)", "https://cran.r-project.org/manuals.html"),
    "aws": ("AWS Skill Builder / Training", "https://aws.amazon.com/training/"),
    "azure": ("Azure training (Microsoft Learn)", "https://learn.microsoft.com/en-us/training/azure/"),
    "gcp": ("Google Cloud training", "https://cloud.google.com/learn/training"),
    "spark": ("Apache Spark documentation", "https://spark.apache.org/docs/latest/"),
    "pyspark": ("PySpark documentation", "https://spark.apache.org/docs/latest/api/python/"),
    "airflow": ("Apache Airflow documentation", "https://airflow.apache.org/docs/"),
    "docker": ("Docker Get Started", "https://docs.docker.com/get-started/"),
    "kubernetes": ("Kubernetes tutorials", "https://kubernetes.io/docs/tutorials/"),
    "git": ("Pro Git book", "https://git-scm.com/book/en/v2"),
    "tensorflow": ("TensorFlow tutorials", "https://www.tensorflow.org/tutorials"),
    "pandas": ("pandas getting started", "https://pandas.pydata.org/docs/getting_started/index.html"),
    "snowflake": ("Snowflake documentation", "https://docs.snowflake.com/"),
    "databricks": ("Databricks documentation", "https://docs.databricks.com/"),
    "java": ("Learn Java (dev.java, Oracle)", "https://dev.java/learn/"),
    "scala": ("Scala documentation", "https://docs.scala-lang.org/"),
    "go": ("Go documentation", "https://go.dev/doc/"),
    "kafka": ("Apache Kafka documentation", "https://kafka.apache.org/documentation/"),
    "hadoop": ("Apache Hadoop documentation", "https://hadoop.apache.org/docs/stable/"),
    "sas": ("SAS training", "https://www.sas.com/en_us/training/home.html"),
    "oracle": ("Oracle Database documentation", "https://docs.oracle.com/en/database/"),
    "redshift": ("Amazon Redshift documentation", "https://docs.aws.amazon.com/redshift/"),
    "nosql": ("MongoDB University (NoSQL)", "https://learn.mongodb.com/"),
    "flow": ("Power Automate (cloud flows) training", "https://learn.microsoft.com/en-us/training/powerplatform/power-automate"),
    "word": ("Word help & learning (Microsoft Support)", "https://support.microsoft.com/en-us/word"),
    "powerpoint": ("PowerPoint help & learning (Microsoft Support)", "https://support.microsoft.com/en-us/powerpoint"),
}


def tool_key(name: str) -> str | None:
    """Map an O*NET software example ("Microsoft Excel") to a LEARNING key ("excel"), word-bounded."""
    low = name.lower()
    for key in sorted(LEARNING, key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", low):
            return key
    return None


def clean(text: str, limit: int = 600) -> str:
    """External text is data: strip control chars/markup, cap length."""
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]|<[^>]{0,200}>", " ", str(text))
    return " ".join(text.split())[:limit]


def load_snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def onet_passages(snap: dict) -> list[dict]:
    out = []
    for soc, o in snap["occupations"].items():
        url = f"https://www.onetonline.org/link/summary/{soc}"
        title = f"O*NET {ONET_VERSION}: {o['title']} ({soc})"
        out.append(ONET_BASE | dict(id=f"onet:{soc}:desc", role_id=soc, skill_id="", category="occupation",
                                    title=title, url=url, text=clean(o["description"])))
        if o["tasks"]:
            out.append(ONET_BASE | dict(id=f"onet:{soc}:tasks", role_id=soc, skill_id="", category="task",
                                        title=title + " - core tasks", url=url, text=clean(" | ".join(o["tasks"]), 900)))
    return out


def learning_passages(snap: dict, check_urls: bool = True) -> list[dict]:
    out = []
    skills = {name: d["element"] for o in snap["occupations"].values() for name, d in o["skills"].items()}
    for name, element in sorted(skills.items()):
        url = f"https://www.onetonline.org/find/descriptor/result/{element}"
        if check_urls and not _alive(url):
            print(f"  dropped dead link: {url}")
            continue
        out.append(ONET_BASE | dict(id=f"learn:{name}", role_id="", skill_id=name, category="learning",
                                    title=f"O*NET OnLine: {name} (definition and where it is used)", url=url,
                                    publication_date="living documentation", license="link only",
                                    text=f"Official O*NET definition of {name} and the occupations that rely on it."))
    tools = sorted({t["name"] for o in snap["occupations"].values() for t in o["tech"]})
    for tool in tools:
        key = tool_key(tool)
        if not key:
            continue
        doc_title, url = LEARNING[key]
        out.append(dict(id=f"learn:{tool}", role_id="", skill_id=tool, category="learning", source_id=f"learn:{key}",
                        title=doc_title, publisher=doc_title.split("(")[-1].rstrip(")") if "(" in doc_title else doc_title,
                        publication_date="living documentation", license="link only", jurisdiction="global",
                        url=url, text=f"Official learning resource for {tool}: {doc_title}."))
    if check_urls:  # vendor URLs: check each distinct one once
        alive = {u: _alive(u) for u in {p["url"] for p in out if not p["id"].startswith("learn:") or p["source_id"] != f"onet:{ONET_VERSION}"}}
        out = [p for p in out if alive.get(p["url"], True)]
    return out


def _alive(url: str) -> bool:
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0 AiversePulse link check"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status < 400
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-url-check", action="store_true")
    ap.add_argument("--no-index", action="store_true")
    ap.add_argument("--index-only", action="store_true", help="re-index the committed passages snapshot")
    a = ap.parse_args()
    if a.index_only:
        from mcp_server.retrieval import build_index
        print("indexed:", build_index(json.loads(PASSAGES.read_text(encoding="utf-8"))))
        return
    snap = load_snapshot()
    ps = onet_passages(snap) + learning_passages(snap, not a.no_url_check)
    access = str(date.today())
    for p in ps:
        p["access_date"] = access
    assert len({p["id"] for p in ps}) == len(ps), "duplicate passage ids"
    PASSAGES.write_text(json.dumps(ps, indent=0, ensure_ascii=False), encoding="utf-8")
    print(f"{len(ps)} passages -> {PASSAGES}")
    if not a.no_index:
        from mcp_server.retrieval import build_index
        print("indexed:", build_index(ps))


if __name__ == "__main__":
    main()
