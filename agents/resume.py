"""Resume agent: file -> Markdown -> redacted Markdown -> O*NET skills/tools with levels and verbatim evidence.

Deterministic and explainable: every extracted skill carries exact quotes from the resume (the Reviewer can verify
them), levels come from documented rules, and nothing is inferred from protected attributes. Raw files are never
stored; callers keep only Markdown.
"""
import io
import re
from functools import lru_cache

from agents.knowledge import snapshot
from agents.profiler import SKILL_ALIASES

MAX_BYTES = 2_000_000
# work verbs -> O*NET skill (documented heuristics; evidence quote always attached)
VERB_SKILLS = {
    r"\b(taught|teach(?:ing)?|trained|mentored|coached)\b": "Instructing",
    r"\bnegotiat\w*": "Negotiation",
    r"\b(budget\w*|forecast(?:ed|ing)? costs?|p&l)\b": "Management of Financial Resources",
    r"\b(supervis\w*|managed (?:a )?team|led (?:a )?team|line manag\w*)\b": "Management of Personnel Resources",
    r"\b(analy[sz]\w*|evaluat\w*|assess\w*)\b": "Critical Thinking",
    r"\b(wrote|writing|authored|documented|reports?)\b": "Writing",
    r"\b(present\w*|public speaking|briefed)\b": "Speaking",
    r"\b(customer|client|patient)s?\b": "Service Orientation",
    r"\b(repair\w*|fixed)\b": "Repairing",
    r"\b(install\w*)\b": "Installation",
    r"\b(troubleshoot\w*|diagnos\w*)\b": "Troubleshooting",
    r"\b(programm\w*|developed software|coded|scripting)\b": "Programming",
    r"\b(schedul\w*|deadlines?|prioriti[sz]\w*)\b": "Time Management",
    r"\b(coordinat\w*|cross-functional)\b": "Coordination",
    r"\b(sales|sold|persuad\w*|pitched)\b": "Persuasion",
    r"\b(monitor\w*)\b": "Monitoring",
    r"\b(quality (?:control|assurance)|inspect\w*|qa\b)": "Quality Control Analysis",
    r"\b(research\w*|experiment\w*|laborator\w*)\b": "Science",
    r"\b(statistic\w*|calculat\w*|math\w*)\b": "Mathematics",
}
SENIOR = re.compile(r"\b(lead|led|senior|principal|head of|architect\w*|expert|manag\w*|owner)\b", re.I)
YEARS = re.compile(r"(\d{1,2})\+?\s*(?:years?|yrs)", re.I)


# ----------------------------------------------------------------------------------- to markdown
def to_markdown(filename: str, data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise ValueError("file larger than 2 MB")
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages[:20])
        return _structure(text)
    if name.endswith(".docx"):
        from docx import Document
        lines = []
        for p in Document(io.BytesIO(data)).paragraphs:
            t = p.text.strip()
            if not t:
                continue
            style = (p.style.name or "").lower()
            lines.append(f"## {t}" if style.startswith("heading") or style == "title" else
                         f"- {t}" if "list" in style else t)
        return "\n".join(lines)
    if name.endswith((".txt", ".md")):
        return _structure(data.decode("utf-8", "replace"))
    raise ValueError("upload a PDF, DOCX, TXT or MD file")


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
@lru_cache(maxsize=1)
def _vocab():
    occ = snapshot()["occupations"].values()
    skills = sorted({s for o in occ for s in o["skills"]})
    tools = sorted({t["name"] for o in occ for t in o["tech"]})
    vendor = re.compile(r"^(microsoft|adobe|apache|oracle|sap|google|amazon web services|amazon|ibm|autodesk|intuit)\s+", re.I)
    tool_alias = {}
    for t in tools:
        tool_alias[t.lower()] = t
        short = vendor.sub("", t).strip()
        if len(short) >= 3 and short.lower() not in ("software", "office software"):
            tool_alias.setdefault(short.lower(), t)
    return skills, tool_alias


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
    """explicit mention 2 (inferred from work verbs 1) +1 if mentioned twice +whole-resume seniority, capped."""
    lines = [l for l in md.split("\n") if rx.search(l)]
    if not lines:
        return 0
    return min(cap, base + (len(lines) >= 2) + _seniority(md))


def extract(md: str) -> dict:
    """-> {"skills": [{name, kind, level, evidence:[quotes]}], "years_experience": int|None}."""
    skills, tool_alias = _vocab()
    found: dict[str, dict] = {}
    names = {s: s for s in skills} | {k: v for k, v in SKILL_ALIASES.items() if v in skills}
    for phrase, skill in sorted(names.items(), key=lambda kv: -len(kv[0])):
        rx = re.compile(rf"(?<![\w-]){re.escape(phrase)}(?![\w-])", re.I)
        if rx.search(md) and skill not in found:
            found[skill] = {"name": skill, "kind": "skill", "level": _level(md, rx), "evidence": _quotes(md, rx)}
    for pattern, skill in VERB_SKILLS.items():
        if skill in found or skill not in skills:
            continue
        rx = re.compile(pattern, re.I)
        if rx.search(md):
            found[skill] = {"name": skill, "kind": "skill", "level": _level(md, rx, base=1, cap=4), "evidence": _quotes(md, rx)}
    for alias, tool in sorted(tool_alias.items(), key=lambda kv: -len(kv[0])):
        if tool in found:
            continue
        rx = re.compile(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", re.I)
        if rx.search(md):
            found[tool] = {"name": tool, "kind": "tool", "level": _level(md, rx), "evidence": _quotes(md, rx)}
    yrs = [int(m.group(1)) for m in YEARS.finditer(md)]
    return {"skills": sorted(found.values(), key=lambda s: (-s["level"], s["name"])),
            "years_experience": max(yrs) if yrs else None}


def verify(md: str, items: list[dict]) -> list[dict]:
    """Keep only skills whose every evidence quote really appears in the resume (guards LLM/edited input)."""
    low = md.lower()
    return [s for s in items if s.get("evidence") and all(q.lower()[:60] in low for q in s["evidence"])]
