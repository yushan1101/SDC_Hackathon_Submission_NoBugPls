"""Build attributed knowledge passages + vector index.

Sources (all public, attribution kept on every passage):
  - O*NET 31.0 database (Aug 2026, CC BY 4.0): occupation descriptions, core tasks, software skills
    (Hot Technology / In Demand flags), essential-skill importance.
  - data_jobs 2023 job-ad aggregates (data/snapshots/role_skills.json).
  - Official vendor/project learning docs (URLs checked at ingest time; dead links dropped).

    python -m mcp_server.ingest --onet data/raw/onet/db_31_0_text.zip
"""
import argparse
import csv
import io
import json
import re
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PASSAGES = ROOT / "data" / "snapshots" / "knowledge_passages.json"
ONET_VERSION, ONET_DATE = "31.0", "2026-08"
ONET_LICENSE = "CC BY 4.0 (O*NET 31.0 Database, U.S. Department of Labor/ETA)"

# Team mapping assumption: data_jobs role -> closest O*NET-SOC occupations (documented, reviewable)
ROLE_SOC = {
    "Data Analyst": ["15-2051.01"], "Senior Data Analyst": ["15-2051.01"],
    "Data Scientist": ["15-2051.00"], "Senior Data Scientist": ["15-2051.00"],
    "Machine Learning Engineer": ["15-2051.00", "15-1221.00"],
    "Data Engineer": ["15-1243.01", "15-1243.00"], "Senior Data Engineer": ["15-1243.01", "15-1243.00"],
    "Business Analyst": ["13-1111.00"], "Software Engineer": ["15-1252.00"],
    "Cloud Engineer": ["15-1299.08", "15-1241.00"],
}
# O*NET "Workplace Example" -> our job-ad skill ID
ONET_SKILL = {
    "Python": "python", "Microsoft SQL Server": "sql server", "Structured query language SQL": "sql",
    "Microsoft Excel": "excel", "Tableau": "tableau", "Microsoft Power BI": "power bi",
    "Amazon Web Services AWS software": "aws", "Microsoft Azure software": "azure", "Google Cloud software": "gcp",
    "Apache Spark": "spark", "PySpark": "pyspark", "Apache Airflow": "airflow", "Docker": "docker",
    "Kubernetes": "kubernetes", "Git": "git", "PyTorch": "pytorch", "TensorFlow": "tensorflow",
    "Scikit-learn": "scikit-learn", "Snowflake": "snowflake", "SAS": "sas", "R": "r", "Scala": "scala",
    "Java": "java", "Linux": "linux", "Go": "go", "NoSQL": "nosql", "Apache Hadoop": "hadoop",
    "Apache Kafka": "kafka", "pandas": "pandas", "Amazon Redshift": "redshift", "Microsoft Word": "word",
    "Microsoft PowerPoint": "powerpoint", "Oracle Database": "oracle", "Google Looker Analytics": "looker",
}
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


def clean(text: str, limit: int = 600) -> str:
    """External text is data: strip control chars/markup, cap length."""
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]|<[^>]{0,200}>", " ", str(text))
    return " ".join(text.split())[:limit]


def _tsv(z, name):
    return list(csv.DictReader(io.StringIO(z.read(f"db_31_0_text/{name}.txt").decode("utf-8")), delimiter="\t"))


def onet_passages(zip_path: Path) -> list[dict]:
    z = zipfile.ZipFile(zip_path)
    occ = {r["O*NET-SOC Code"]: r for r in _tsv(z, "Occupation Data")}
    tasks, soft, ess = _tsv(z, "Task Statements"), _tsv(z, "Software Skills"), _tsv(z, "Essential Skills")
    out = []
    base = dict(source_id=f"onet:{ONET_VERSION}", publisher="O*NET Resource Center (USDOL/ETA)",
                publication_date=ONET_DATE, license=ONET_LICENSE, jurisdiction="US")
    for role, socs in ROLE_SOC.items():
        for soc in socs:
            o = occ[soc]
            url = f"https://www.onetonline.org/link/summary/{soc}"
            title = f"O*NET {ONET_VERSION}: {o['Title']} ({soc})"
            out.append(base | dict(id=f"onet:{soc}:desc:{role}", role_id=role, skill_id="", category="occupation",
                                   title=title, url=url, text=clean(o["Description"])))
            core = [t["Task"] for t in tasks if t["O*NET-SOC Code"] == soc and t["Task Type"] == "Core"][:6]
            if core:
                out.append(base | dict(id=f"onet:{soc}:tasks:{role}", role_id=role, skill_id="", category="task",
                                       title=title + " - core tasks", url=url, text=clean(" | ".join(core), 900)))
            for r in soft:
                if r["O*NET-SOC Code"] == soc and r["Workplace Example"] in ONET_SKILL:
                    sk = ONET_SKILL[r["Workplace Example"]]
                    flags = [f for f, k in (("Hot Technology", "Hot Technology"), ("In Demand", "In Demand")) if r[k] == "Y"]
                    out.append(base | dict(id=f"onet:{soc}:sw:{sk}:{role}", role_id=role, skill_id=sk, category="software",
                                           title=title + f" - {r['Workplace Example']}", url=url,
                                           text=clean(f"O*NET lists {r['Workplace Example']} ({r['Element Name']}) as software used by "
                                                      f"{o['Title']}." + (f" Flagged: {', '.join(flags)}." if flags else ""))))
            imp = sorted((r for r in ess if r["O*NET-SOC Code"] == soc and r["Scale ID"] == "IM"),
                         key=lambda r: -float(r["Data Value"]))[:6]
            if imp:
                out.append(base | dict(id=f"onet:{soc}:skills:{role}", role_id=role, skill_id="", category="competency",
                                       title=title + " - most important skills", url=url,
                                       text=clean("Importance (1-5): " + "; ".join(f"{r['Element Name']} {r['Data Value']}" for r in imp))))
    return out


def job_ad_passages() -> list[dict]:
    p = json.loads((ROOT / "data" / "snapshots" / "role_skills.json").read_text(encoding="utf-8"))
    a, b = p["window"]
    return [dict(id=f"data_jobs:{role}:{s}", role_id=role, skill_id=s, category="job_ads", source_id=p["source_id"],
                 title=f"data_jobs (Luke Barousse, Ashy24 mirror): '{s}' in {role} job ads, {a}..{b}",
                 publisher="Luke Barousse / Hugging Face", publication_date="2026-09-17", license="Apache-2.0",
                 jurisdiction="global", url=p["source_url"],
                 text=f"{pct}% of {r['eligible_posts']:,} deduplicated {role} postings with a skill list mention '{s}'.")
            for role, r in p["roles"].items() for s, pct in r["skills"].items()]


def learning_passages(check_urls: bool = True) -> list[dict]:
    out = []
    for sk, (title, url) in LEARNING.items():
        if check_urls and not _alive(url):
            print(f"  dropped dead link: {url}")
            continue
        out.append(dict(id=f"learn:{sk}", role_id="", skill_id=sk, category="learning", source_id=f"learn:{sk}",
                        title=title, publisher=title.split("(")[-1].rstrip(")") if "(" in title else title,
                        publication_date="living documentation", license="link only", jurisdiction="global",
                        url=url, text=f"Official learning resource for {sk}: {title}."))
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
    ap.add_argument("--onet", default="data/raw/onet/db_31_0_text.zip")
    ap.add_argument("--no-url-check", action="store_true")
    ap.add_argument("--no-index", action="store_true")
    ap.add_argument("--index-only", action="store_true", help="re-index the committed passages snapshot (no O*NET zip)")
    a = ap.parse_args()
    if a.index_only:
        from mcp_server.retrieval import build_index
        print("indexed:", build_index(json.loads(PASSAGES.read_text(encoding="utf-8"))))
        return
    ps = onet_passages(Path(a.onet)) + job_ad_passages() + learning_passages(not a.no_url_check)
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
