"""pgvector store (AIVERSEPULSE_DATABASE_URL set): search, filters, scores and the one-transaction live swap.
Runs on the Postgres CI job only; a word-hashing embedding stands in for MiniLM so no model download is needed."""
import hashlib
import math
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="pgvector store: Postgres runs only")


def fake_embed(texts):
    out = []
    for t in texts:
        v = [0.0] * 384
        for w in t.lower().replace(".", " ").split():
            v[int(hashlib.sha1(w.encode()).hexdigest(), 16) % 384] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        out.append([x / n for x in v])
    return out


def passage(pid, title, text, **meta):
    return {"id": pid, "title": title, "text": text, "category": "occupation", "role_id": "", **meta}


@pytest.fixture
def store(monkeypatch):
    from mcp_server import retrieval
    monkeypatch.setattr(retrieval, "_embed", fake_embed)
    monkeypatch.setattr(retrieval.READY, "is_set", lambda: True)
    assert retrieval._pg() is not None
    return retrieval


def test_search_ranks_by_cosine_and_filters(store):
    store.build_index([
        passage("nurse", "Nurse", "caring for hospital patients", role_id="29-1141"),
        passage("chef", "Chef", "cooking meals in a kitchen", role_id="35-1011"),
        passage("course", "Patient care course", "hospital patients caring skills", category="learning"),
    ])
    hits, mode = store.search("Nurse. caring for hospital patients", top_k=5)  # passages are embedded as "title. text"
    assert mode == "vector" and [h["id"] for h in hits][:2] == ["nurse", "course"]
    assert hits[0]["score"] == pytest.approx(1.0, abs=1e-4) and hits[0]["text"] == "caring for hospital patients"
    assert 0 < hits[1]["score"] < hits[0]["score"]
    assert hits[0]["title"] == "Nurse" and hits[0]["role_id"] == "29-1141"  # metadata comes back like Chroma's
    only, _ = store.search("caring for hospital patients", {"category": "learning"}, 5)
    assert [h["id"] for h in only] == ["course"]
    both, _ = store.search("kitchen", {"category": "occupation", "role_id": "35-1011"}, 5)
    assert [h["id"] for h in both] == ["chef"]
    assert store.ensure_index() == 3  # already filled: reused, not rebuilt


def test_live_set_is_swapped_in_one_transaction(store):
    store.index_live([passage("job-1", "Data analyst", "sql dashboards reporting"), passage("job-2", "Welder", "steel welding")])
    store.index_live([passage("job-3", "ML engineer", "python models training")])
    assert [p["id"] for p in store.live_offline()] == ["job-3"]  # yesterday's postings are gone
    hits, mode = store.search_live("python models training")
    assert mode == "vector" and [h["id"] for h in hits] == ["job-3"]


def test_another_node_sees_the_same_rows(store):
    from governance.db import PgConnection
    store.index_live([passage("job-9", "Nurse", "night shift ward")])
    other = PgConnection(os.environ["AIVERSEPULSE_DATABASE_URL"], store._pg().schema)  # a second app node: its own connection
    assert other.execute("SELECT id FROM vec_passages WHERE collection=?", (store.LIVE,)).fetchall() == [("job-9",)]
