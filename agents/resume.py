"""Resume agent: file -> guarded Markdown -> redacted Markdown -> ESCO skills/tools with levels and verbatim evidence.

Deterministic and explainable: every extracted skill carries exact quotes from the resume (the Reviewer can verify
them), levels come from documented rules, and nothing is inferred from protected attributes. Raw files are never
stored; callers keep only Markdown.
"""
import re
from functools import lru_cache

from agents.knowledge import snapshot
from validation.document_guard import fingerprint, inspect

MAX_BYTES = 2_000_000
SENIOR = re.compile(r"\b(lead|led|senior|principal|head of|architect\w*|expert|manag\w*|owner)\b", re.I)
YEARS = re.compile(r"(\d{1,2})\+?\s*(?:years?|yrs)", re.I)


# ----------------------------------------------------------------------------------- to markdown
def convert(filename: str, data: bytes) -> tuple[str, dict]:
    """-> (Markdown of the VISIBLE, sanitised content, integrity report). Hidden text, invisible characters and
    instruction-like lines never reach the agents (validation/document_guard.py)."""
    if len(data) > MAX_BYTES:
        raise ValueError("file larger than 2 MB")
    text, report = inspect(filename, data)
    md = text if filename.lower().endswith(".docx") else _structure(text)
    report["sha256"] = fingerprint(md)
    return md, report


def to_markdown(filename: str, data: bytes) -> str:
    return convert(filename, data)[0]


def _structure(text: str) -> str:
    out = []
    for raw in text.replace("\r", "").split("\n"):
        line = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", raw).strip()
        if not line:
            continue
        if line.startswith("#"):
            out.append(line)
        elif re.match(r"^[•●▪◦\-*–]\s*", line):
            out.append("- " + re.sub(r"^[•●▪◦\-*–]\s*", "", line))
        elif len(line) <= 40 and (line.isupper() or line.endswith(":")) and not re.search(r"\d{3}", line):
            out.append(f"## {line.rstrip(':').title()}")
        else:
            out.append(line)
    return "\n".join(out)


# ----------------------------------------------------------------------------------- redaction (blind review)
PII = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"\+?\d[\d ()\-.]{7,}\d"),  # only sequences with 9+ digits (keeps year ranges like 2021-2026)
     lambda m: "[phone]" if sum(c.isdigit() for c in m.group(0)) >= 9 else m.group(0)),
    (re.compile(r"https?://\S+|www\.\S+|linkedin\.com/\S+", re.I), "[link]"),
    (re.compile(r"\b(?:date of birth|dob|born)\b[^\n]*", re.I), "[birth date]"),
    (re.compile(r"\b\d{1,2}\s*(?:years old|y/o)\b", re.I), "[age]"),
    (re.compile(r"\b(?:male|female|married|single|divorced|nationality|religion|pregnan\w*)\b[^\n,]*", re.I), "[personal detail]"),
    (re.compile(r"\b(he|she|him|her|his|hers|mr|mrs|ms|miss)\b\.?", re.I), "they"),
]


def redact(md: str) -> str:
    lines = md.split("\n")
    for i, l in enumerate(lines):  # the first short heading-like line is usually the name
        t = l.lstrip("# ").strip()
        if t:
            if len(t.split()) <= 4 and not re.search(r"\d|@", t):
                lines[i] = "# [Candidate]"
            break
    out = "\n".join(lines)
    for rx, rep in PII:
        out = rx.sub(rep, out)
    return out


# ----------------------------------------------------------------------------------- extraction
UNIT = 0.60      # cosine between a resume line/phrase and an ESCO skill label to claim the skill
LISTED = 0.68    # stricter for short skill-list items: they are claims, not described work
MAX_SKILLS = 30


def _quotes(md: str, rx: re.Pattern, limit: int = 2) -> list[str]:
    out = []
    for line in md.split("\n"):
        if rx.search(line):
            out.append(line.strip("-# ").strip()[:160])
            if len(out) >= limit:
                break
    return out


def _seniority(md: str) -> int:
    """Whole-resume experience bonus: +1 for >=3 years or a senior/lead role, +2 for >=8 years and senior."""
    yrs = max([int(m.group(1)) for m in YEARS.finditer(md)] or [0])
    senior = bool(SENIOR.search(md))
    return 2 if yrs >= 8 and senior else 1 if yrs >= 3 or senior else 0


def _level(md: str, rx: re.Pattern, base: int = 2, cap: int = 5) -> int:
    """explicit mention 2 +1 if mentioned twice +whole-resume seniority, capped."""
    lines = [l for l in md.split("\n") if rx.search(l)]
    if not lines:
        return 0
    return min(cap, base + (len(lines) >= 2) + _seniority(md))


def _units(md: str) -> list[tuple[str, str, bool]]:
    """-> [(text to classify, the verbatim resume line it came from, is a short list item)]."""
    out = []
    for line in md.split("\n"):
        raw = line.strip("-#* ").strip()
        if len(raw) < 3 or raw == "[Candidate]" or raw.startswith("[removed"):
            continue
        parts = [p.strip() for p in re.split(r"[,;•|]", raw)] if raw.count(",") >= 2 or len(raw) < 60 else [raw]
        for p in parts:
            if 3 <= len(p) <= 220:
                out.append((p, raw[:160], len(p) <= 40))
        for sent in re.split(r"(?<=[.!?])\s+|:\s+", raw):  # long lines: also each sentence/clause
            if len(raw) >= 60 and 12 <= len(sent) <= 220 and sent != raw:
                out.append((sent, raw[:160], False))
    return out[:300]


@lru_cache(maxsize=1)
def _tool_labels() -> dict[str, str]:
    """Tool-like ESCO labels (software, systems), matched by exact mention."""
    occ = snapshot()["occupations"].values()
    return {t["name"].lower(): t["name"] for o in occ for t in o["tech"]}


def extract(md: str) -> dict:
    """-> {"skills": [{name, kind, level, evidence:[quotes], similarity}], "years_experience": int|None}.
    Semantic classifier: each resume line/phrase is matched to ESCO skill labels; tools by exact mention."""
    from agents.skillmap import encode, vocabulary
    import numpy as np
    names, V = vocabulary()
    units = _units(md)
    found: dict[str, dict] = {}
    for low, tool in _tool_labels().items():
        rx = re.compile(rf"(?<![\w-]){re.escape(low)}(?![\w-])", re.I)
        if len(low) >= 3 and rx.search(md):
            found[tool] = {"name": tool, "kind": "tool", "level": _level(md, rx), "evidence": _quotes(md, rx), "similarity": 1.0}
    if units:
        from agents.profiler import expand
        S = encode([expand(u) if listed else u for u, _, listed in units]) @ V.T
        for i, (text, line, listed) in enumerate(units):
            for j in np.argsort(-S[i])[:2]:
                sim = float(S[i, j])
                if sim < (LISTED if listed else UNIT):
                    break
                name = names[j]
                prev = found.get(name)
                if prev and (prev["similarity"] >= sim or prev["kind"] == "tool"):
                    if line not in prev["evidence"] and len(prev["evidence"]) < 2:
                        prev["evidence"].append(line)
                    continue
                found[name] = {"name": name, "kind": "skill", "similarity": round(sim, 3),
                               "level": min(5 if listed else 4, (2 if listed else 1) + (sim >= 0.75) + _seniority(md)),
                               "evidence": [line] + ([q for q in (prev or {}).get("evidence", []) if q != line][:1])}
    yrs = [int(m.group(1)) for m in YEARS.finditer(md)]
    ranked = sorted(found.values(), key=lambda s: (-s["similarity"], -s["level"], s["name"]))[:MAX_SKILLS]
    return {"skills": sorted(ranked, key=lambda s: (-s["level"], s["name"])), "years_experience": max(yrs) if yrs else None}


def verify(md: str, items: list[dict]) -> list[dict]:
    """Keep only skills whose every evidence quote really appears in the resume (guards LLM/edited input)."""
    low = md.lower()
    return [s for s in items if s.get("evidence") and all(q.lower()[:60] in low for q in s["evidence"])]
