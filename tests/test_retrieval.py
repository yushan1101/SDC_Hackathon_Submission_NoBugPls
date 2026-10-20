from agents.knowledge import search_role_skills


def test_evidence_has_provenance():
    skills, ev, meta = search_role_skills("Data Analyst")
    assert ev and meta["retrieval_mode"] == "offline"
    assert all(e.url.startswith("https://") and e.publication_date and e.excerpt for e in ev)


def test_unknown_role_empty_not_invented():  # T-05 style: no evidence -> empty, never invented
    assert search_role_skills("Astronaut")[1] == []


def test_vector_search_after_warmup():
    import pytest
    pytest.importorskip("sentence_transformers")
    from mcp_server import retrieval
    try:
        retrieval._collection()
    except Exception:
        pytest.skip("no Chroma index built (CI): offline path covered elsewhere")
    retrieval.warm()
    hits, mode = retrieval.search("cloud skills for data engineers", {"role_id": "Data Engineer"}, 3)
    assert mode == "vector" and len(hits) == 3 and all(h["role_id"] == "Data Engineer" for h in hits)
