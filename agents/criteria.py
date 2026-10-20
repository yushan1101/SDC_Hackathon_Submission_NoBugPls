"""Natural-language screening thresholds -> structured criteria the screening agents apply.

Deterministic grammar (works without any LLM), echoed back to HR for confirmation before use:
  "top 5" / "best 3" / "shortlist 10"            -> top_k
  "match above 70%" / "fit >= 0.7"               -> min_fit
  "3+ years" / "at least 2 years"                -> min_years
  "<skill> at least 3" / "<skill> >= 4" / "strong <skill>" (4) / "basic <skill>" (2) -> min_levels
  "must know / must have / requires <tool>, <tool> and <tool>"                       -> required_tools
Skill phrases resolve to the closest ESCO skill label (MiniLM); tools are checked against the resume text itself.
Unparsed clauses are returned as notes (never silently dropped). Criteria about protected characteristics are
refused: the agents rank on job-related skills and evidence only.
"""
import re

PROTECTED = re.compile(r"\b(age|aged|young|old(?:er)?|gender|male|female|man|woman|men|women|race|ethnic\w*|religio\w*|"
                       r"nationalit\w*|citizen\w*|married|marital|pregnan\w*|disabilit\w*|disabled|sexual\w*|"
                       r"native speaker|photo|attractive|caste|skin)\b", re.I)
WORD_LEVELS = {"expert": 5, "advanced": 4, "strong": 4, "solid": 3, "good": 3, "intermediate": 3, "basic": 2, "some": 2}
LEVEL_WORDS = "|".join(WORD_LEVELS)
KEYWORDS = re.compile(r"\d|\b(match|fit|score|years?|top|best|shortlist|level|at least)\b", re.I)
RESOLVE = 0.58  # cosine needed to map an HR phrase onto an ESCO skill label


def _skill(phrase: str, strict: bool = False) -> str | None:
    """Closest ESCO label; strict=True returns None instead of the raw phrase when nothing is close."""
    from agents.profiler import expand
    from agents.skillmap import nearest
    p = expand(phrase.strip(" .:-").lower())
    hit = nearest(p, 1, RESOLVE)
    return hit[0][0] if hit else None if strict else p[:1].upper() + p[1:]


def parse(text: str, soc: str | None = None) -> dict:
    text = (text or "")[:1000]
    out = {"top_k": None, "min_fit": None, "min_years": None, "min_levels": {}, "required_tools": [],
           "notes": [], "blocked": []}
    if m := PROTECTED.findall(text):
        out["blocked"] = sorted({x.lower() for x in m})
    used = []
    if m := re.search(r"\b(?:top|best|shortlist|pick)\s+(\d{1,3})\b", text, re.I):
        out["top_k"] = int(m.group(1)); used.append(m.span())
    if m := re.search(r"\b(?:match|fit|score)\w*[^\d%]{0,20}?(\d{1,3}(?:\.\d+)?)\s*(%)?", text, re.I):
        v = float(m.group(1))
        out["min_fit"] = round(v / 100 if m.group(2) or v > 1 else v, 3); used.append(m.span())
    if m := re.search(r"(?:at least\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs)", text, re.I):
        out["min_years"] = int(m.group(1)); used.append(m.span())
    for m in re.finditer(r"\b(?:must (?:know|have|use)|requires?|required:?|with experience in)\s+([^.;]+)", text, re.I):
        end = m.start(1)
        for part in re.split(r",|\band\b|/", m.group(1)):
            if KEYWORDS.search(part):
                break  # the tool list ended; the rest of the sentence is other criteria
            end += len(part) + 1
            part = re.sub(r"\b(experience|skills?|knowledge|of|in|the)\b", "", part, flags=re.I).strip(" .")
            if len(part) >= 2 and part not in out["required_tools"]:
                out["required_tools"].append(part)
        used.append((m.start(), end))
    for m in re.finditer(rf"\b({LEVEL_WORDS})\s+([a-z][a-z \-+#/]{{2,40}}?)(?=[,.;\n]|\band\b|$)", text, re.I):
        if not any(a <= m.start() < b for a, b in used) and (s := _skill(m.group(2), strict=True)):
            out["min_levels"][s] = max(out["min_levels"].get(s, 0), WORD_LEVELS[m.group(1).lower()])
            used.append(m.span())
    for m in re.finditer(r"([a-z][a-z \-+#/]{2,40}?)\s*(?:level|at least|>=|≥|min(?:imum)?|of|:)\s*(\d)\b", text, re.I):
        if not any(a <= m.start() < b for a, b in used):
            s = _skill(re.sub(r"^(and|with|plus)\s+", "", m.group(1).strip(), flags=re.I))
            out["min_levels"][s] = max(out["min_levels"].get(s, 0), min(int(m.group(2)), 5))
            used.append(m.span())
    for clause in re.split(r"[,.;\n]|\band\b", text):
        c = clause.strip()
        if len(c) < 4:
            continue
        start = text.find(c)
        if not any(a <= start < b or a < start + len(c) <= b for a, b in used):
            out["notes"].append(f"Not understood, ignored: “{c}”")
    return out


def describe(c: dict) -> list[str]:
    """Plain-language echo of what the agents will apply (shown to HR before saving)."""
    lines = []
    if c.get("blocked"):
        lines.append(f"Refused: criteria about protected characteristics ({', '.join(c['blocked'])}) are not allowed.")
    if c.get("top_k"):
        lines.append(f"Recommend the best {c['top_k']} candidates.")
    if c.get("min_fit") is not None:
        lines.append(f"Overall match at least {c['min_fit']:.0%}.")
    if c.get("min_years") is not None:
        lines.append(f"At least {c['min_years']} years of stated experience.")
    lines += [f"{k} at level {v}/5 or higher (ESCO skill, from resume evidence)." for k, v in c.get("min_levels", {}).items()]
    lines += [f"Must show {t} in the resume." for t in c.get("required_tools", [])]
    return lines + c.get("notes", [])
