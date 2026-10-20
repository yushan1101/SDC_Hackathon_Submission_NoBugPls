"""Natural-language screening thresholds -> structured criteria the screening agents apply.

Deterministic grammar (works without any LLM), echoed back to HR for confirmation before use:
  "top 5" / "best 3" / "shortlist 10"            -> top_k
  "match above 70%" / "fit >= 0.7"               -> min_fit
  "3+ years" / "at least 2 years"                -> min_years
  "<skill> at least 3" / "<skill> >= 4" / "strong <skill>" (4) / "basic <skill>" (2) -> min_levels
  "must know / must have / requires <tool>, <tool> and <tool>"                       -> required_tools
Unparsed clauses are returned as notes (never silently dropped). Criteria about protected characteristics are
refused: the agents rank on job-related skills and evidence only.
"""
import re

from agents.knowledge import known_skills, snapshot
from agents.profiler import SKILL_ALIASES

PROTECTED = re.compile(r"\b(age|aged|young|old(?:er)?|gender|male|female|man|woman|men|women|race|ethnic\w*|religio\w*|"
                       r"nationalit\w*|citizen\w*|married|marital|pregnan\w*|disabilit\w*|disabled|sexual\w*|"
                       r"native speaker|photo|attractive|caste|skin)\b", re.I)
WORD_LEVELS = {"expert": 5, "advanced": 4, "strong": 4, "solid": 3, "good": 3, "intermediate": 3, "basic": 2, "some": 2}


def _vocab(soc: str | None):
    occ = snapshot()["occupations"]
    skills = {s for s in known_skills() if s in {n for o in occ.values() for n in o["skills"]}}
    tools = sorted({t["name"] for o in occ.values() for t in o["tech"]})
    names = {s.lower(): s for s in skills} | {k: v for k, v in SKILL_ALIASES.items() if v in skills}
    return names, tools


def _tool(word: str, tools: list[str]) -> str | None:
    w = word.strip(" .").lower()
    if len(w) < 2:
        return None
    exact = [t for t in tools if t.lower() == w]
    if exact:
        return exact[0]
    hits = [t for t in tools if re.search(rf"(?<![\w-]){re.escape(w)}(?![\w-])", t.lower())]
    return min(hits, key=len) if hits else word.strip(" .")


def parse(text: str, soc: str | None = None) -> dict:
    text = (text or "")[:1000]
    out = {"top_k": None, "min_fit": None, "min_years": None, "min_levels": {}, "required_tools": [],
           "notes": [], "blocked": []}
    if m := PROTECTED.findall(text):
        out["blocked"] = sorted({x.lower() for x in m})
    names, tools = _vocab(soc)
    used = []
    if m := re.search(r"\b(?:top|best|shortlist|pick)\s+(\d{1,3})\b", text, re.I):
        out["top_k"] = int(m.group(1)); used.append(m.span())
    if m := re.search(r"\b(?:match|fit|score)\w*[^\d%]{0,20}?(\d{1,3}(?:\.\d+)?)\s*(%)?", text, re.I):
        v = float(m.group(1))
        out["min_fit"] = round(v / 100 if m.group(2) or v > 1 else v, 3); used.append(m.span())
    if m := re.search(r"(?:at least\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs)", text, re.I):
        out["min_years"] = int(m.group(1)); used.append(m.span())
    for phrase, skill in sorted(names.items(), key=lambda kv: -len(kv[0])):
        for m in re.finditer(rf"(?:(\b{'|'.join(WORD_LEVELS)})\s+)?\b{re.escape(phrase)}\b(?:\W{{0,12}}(?:level|at least|>=|≥|min(?:imum)?|of|:)?\s*(\d))?",
                             text, re.I):
            if any(a <= m.start() < b for a, b in used):
                continue
            lvl = int(m.group(2)) if m.group(2) else WORD_LEVELS.get((m.group(1) or "").lower())
            if lvl:
                out["min_levels"][skill] = max(out["min_levels"].get(skill, 0), min(lvl, 5))
                used.append(m.span())
    for m in re.finditer(r"\b(?:must (?:know|have|use)|requires?|required:?|with experience in)\s+([^.;]+)", text, re.I):
        for part in re.split(r",|\band\b|/", m.group(1)):
            if re.search(r"\d|\b(match|fit|score|years?|top|best|shortlist|level)\b", part, re.I):
                break  # the tool list ended; the rest of the sentence is other criteria
            part = re.sub(r"\b(experience|skills?|knowledge|of|in|the)\b", "", part, flags=re.I).strip()
            if part and not any(part.lower() == s.lower() for s in out["min_levels"]):
                t = _tool(part, tools)
                if t and t not in out["required_tools"]:
                    out["required_tools"].append(t)
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
    lines += [f"{k} at level {v}/5 or higher (from resume evidence)." for k, v in c.get("min_levels", {}).items()]
    lines += [f"Must show {t} in the resume." for t in c.get("required_tools", [])]
    return lines + c.get("notes", [])
