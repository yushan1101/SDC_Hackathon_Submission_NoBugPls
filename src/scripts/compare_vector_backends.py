"""Chroma vs pgvector: same passages, same MiniLM embeddings, same queries -> are the top-5 results the same?

    AIVERSEPULSE_DATABASE_URL=postgresql://... python scripts/compare_vector_backends.py

Embeds the knowledge snapshot once, loads the identical vectors into a temporary Chroma index and into a scratch
pgvector table, then compares each query's top 5 (ids in order, and as a set). Where they differ it says which store
returned the closer passages (pgvector searches exactly; Chroma's HNSW index is approximate). Writes nothing else.
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

QUERIES = [  # (query, where): free text across the corpus and with the filters the agents use
    ("caring for hospital patients", None), ("caring for hospital patients", {"category": "occupation"}),
    ("software developer writing code", None), ("data analysis with sql and dashboards", {"category": "learning"}),
    ("machine learning engineer", {"category": "occupation"}), ("financial accounting and auditing", None),
    ("teaching children in a classroom", {"category": "occupation"}), ("project management skills", {"category": "learning"}),
    ("repairing electrical equipment", {"category": "task"}), ("customer service on the phone", None),
    ("truck driving and logistics", {"category": "occupation"}), ("cyber security incident response", None),
    ("cooking in a restaurant kitchen", {"category": "occupation"}), ("statistics course for beginners", {"category": "learning"}),
    ("writing reports for management", {"category": "task"}), ("legal advice and contracts", None),
    ("graphic design and illustration", {"category": "occupation"}), ("public speaking and presentation", {"category": "learning"}),
    ("welding steel structures", None), ("cloud computing infrastructure", {"category": "learning"}),
    ("monitoring patient vital signs", {"category": "task"}), ("sales negotiation", None),
    ("python programming", {"category": "learning"}), ("construction site safety", {"category": "task"}),
]


def main():
    from mcp_server import retrieval
    from governance.db import connect
    passages = retrieval.offline_passages()
    role = next(p["role_id"] for p in passages if p.get("role_id") and p["category"] == "task")
    queries = QUERIES + [("main duties of this job", {"role_id": role}), ("main duties of this job", {"role_id": role, "category": "task"})]

    t = time.time()
    emb = []
    for i in range(0, len(passages), 256):
        part = passages[i:i + 256]
        emb += retrieval._embed(p["title"] + ". " + p["text"] for p in part)
    print(f"embedded {len(passages)} passages in {time.time() - t:.0f}s")
    metas = [{k: p.get(k, "") for k in retrieval.META_KEYS} for p in passages]

    import chromadb
    col = chromadb.PersistentClient(path=tempfile.mkdtemp()).create_collection("cmp", metadata={"hnsw:space": "cosine"})
    for i in range(0, len(passages), 2000):
        col.add(ids=[p["id"] for p in passages[i:i + 2000]], documents=[p["text"] for p in passages[i:i + 2000]],
                embeddings=emb[i:i + 2000], metadatas=metas[i:i + 2000])

    con = connect()
    con.execute("CREATE EXTENSION IF NOT EXISTS vector")
    con.executescript("CREATE TEMP TABLE cmp(id TEXT PRIMARY KEY, meta JSONB, embedding vector(384));")
    with con:
        con.executemany("INSERT INTO cmp VALUES(?, ?::jsonb, ?::vector)",
                        [(p["id"], json.dumps(m), retrieval._vec(e)) for p, m, e in zip(passages, metas, emb)])

    same_order = same_set = 0
    rows = []
    for q, where in queries:
        qe = retrieval._embed([q])[0]
        flt = {"$and": [{k: v} for k, v in where.items()]} if where and len(where) > 1 else where
        r = col.query(query_embeddings=[qe], n_results=5, where=flt)
        c_ids, c_dist = r["ids"][0], r["distances"][0]
        sql, args = "SELECT id, embedding <=> ?::vector AS d FROM cmp", [retrieval._vec(qe)]
        if where:
            sql += " WHERE meta @> ?::jsonb"
            args.append(json.dumps(where))
        p_rows = con.execute(sql + " ORDER BY d, id LIMIT 5", args).fetchall()
        p_ids, p_dist = [i for i, _ in p_rows], [d for _, d in p_rows]
        same_order += c_ids == p_ids
        same_set += set(c_ids) == set(p_ids)
        verdict = "same" if c_ids == p_ids else ("same set, order differs" if set(c_ids) == set(p_ids) else
                  f"{len(set(c_ids) & set(p_ids))}/5 shared; mean distance chroma {sum(c_dist) / 5:.4f} vs pgvector {sum(p_dist) / 5:.4f}")
        rows.append((q, json.dumps(where) if where else "-", verdict, max(abs(a - b) for a, b in zip(c_dist, p_dist)) if c_ids == p_ids else None))

    for q, w, v, dd in rows:
        print(f"{'OK ' if v == 'same' else 'DIF'} | {q[:38]:38} | {w[:44]:44} | {v}" + (f" | max |distance diff| {dd:.1e}" if dd is not None else ""))
    print(f"\n==== {same_order}/{len(queries)} identical top-5 (ids and order), {same_set}/{len(queries)} same top-5 set ====")


if __name__ == "__main__":
    if not os.environ.get("AIVERSEPULSE_DATABASE_URL"):
        sys.exit("set AIVERSEPULSE_DATABASE_URL to a Postgres database with pgvector")
    main()
