import json

from agents.knowledge import resolve_occupation, role_requirements, search_occupations
from mcp_server.ingest import PASSAGES


def test_requirements_for_non_tech_jobs():
    for soc, title in [("2221.2", "Nurse responsible for general care"), ("7411.1", "Electrician"),
                       ("4225.1", "Customer service representative")]:
        reqs, ev, meta = role_requirements(soc)
        assert meta["title"] == title and len(reqs) >= 8
        ids = {e.id for e in ev}
        assert all(r["evidence_id"] in ids for r in reqs.values())
        assert all(e.url.startswith("https://esco.ec.europa.eu/") and e.publication_date and "prediction" in e.excerpt for e in ev)


def test_occupation_search_and_alternate_titles():
    assert "2221.2" in [r["soc"] for r in search_occupations("nurse general care")]
    assert resolve_occupation("Nurse responsible for general care") == "2221.2"
    assert resolve_occupation("Electricians") == "7411.1"  # plural of the ESCO title
    assert resolve_occupation("2411.1") == "2411.1"
    assert resolve_occupation("Astronaut chef of Mars") is None and search_occupations("") == []


def test_unknown_role_empty_not_invented():  # T-05 style: no evidence -> empty, never invented
    reqs, ev, meta = role_requirements("Astronaut chef of Mars")
    assert reqs == {} and ev == [] and not meta["found"]


def test_runtime_knowledge_has_no_2023_job_ads():
    ps = json.loads(PASSAGES.read_text(encoding="utf-8"))
    assert ps and not any(p["category"] == "job_ads" or p["id"].startswith("data_jobs") for p in ps)


def test_vector_search_after_warmup():
    import pytest
    pytest.importorskip("sentence_transformers")
    from mcp_server import retrieval
    try:
        retrieval._collection()
    except Exception:
        pytest.skip("no Chroma index built (CI): offline path covered elsewhere")
    retrieval.warm()
    hits, mode = retrieval.search("caring for hospital patients", {"category": "occupation"}, 5)
    assert mode == "vector" and len(hits) == 5
