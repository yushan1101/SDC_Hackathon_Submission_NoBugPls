"""Every citation the Coach writes is verified on its own, even when an LLM packs several into one bracket."""
from agents import coach

KNOWN = {"esco:5321.1:skill:Person centred care", "esco:5321.1:skill:Address problems critically"}
TEXT = ("Focus on person-centred care [esco:5321.1:skill:Person centred care, esco:5321.1:skill:Address problems critically, "
        "esco:5321.1:skill:Invented skill that was never retrieved by the knowledge agent at all for this role].")


def test_multi_citation_brackets_are_split_and_each_id_checked():
    assert coach.citations(TEXT) == sorted(coach.citations(TEXT), key=coach.citations(TEXT).index)  # stable order
    assert set(coach.citations(TEXT)) == KNOWN | {"esco:5321.1:skill:Invented skill that was never retrieved by the knowledge agent at all for this role"}
    out = coach.strip_unknown(TEXT, KNOWN)
    assert "Invented" not in out
    assert "[esco:5321.1:skill:Person centred care][esco:5321.1:skill:Address problems critically]" in out
    assert [c for c in coach.citations(out) if c not in KNOWN] == []


def test_normalize_keeps_single_citations():
    s = "Do this [esco:1:skill:A]."
    assert coach.normalize(s) == s
