from agents.knowledge import search_role_skills


def test_evidence_has_provenance():
    skills, ev, meta = search_role_skills("Data Analyst")
    assert ev and meta["retrieval_mode"] == "offline"
    assert all(e.url.startswith("https://") and e.publication_date and e.excerpt for e in ev)


def test_unknown_role_empty_not_invented():  # T-05 style: no evidence -> empty, never invented
    assert search_role_skills("Astronaut")[1] == []
