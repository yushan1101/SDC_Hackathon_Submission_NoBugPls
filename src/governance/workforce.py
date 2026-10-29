"""Organization-scoped workforce aggregates and fictional preview data."""
import json
import math
from collections import Counter, defaultdict

MIN_GROUP = 3
MIN_COVERAGE = 0.6
TOP_SKILLS = 12  # rows shown when no skill filter is set; a real report lists ~45 ESCO skills
SOURCES = {"employee": "Employee self-analyses", "hr_upload": "HR uploads"}

DEPARTMENTS = {
    "Customer Support": ["Support Specialist", "Support Team Lead"],
    "Marketing": ["Marketing Coordinator", "Marketing Manager"],
    "Data & Analytics": ["Data Analyst", "Analytics Lead"],
    "Operations": ["Operations Coordinator", "Operations Manager"],
    "Human Resources": ["People Operations Specialist", "HR Business Partner"],
}
SKILLS = ["AI literacy", "Data analysis", "Workflow automation", "Communication",
          "Cybersecurity awareness", "Problem solving", "Digital tools"]
ROLE_TARGETS = {
    "Support Specialist": [3, 2, 2, 4, 3, 4, 3], "Support Team Lead": [4, 3, 3, 5, 4, 5, 4],
    "Marketing Coordinator": [3, 3, 3, 4, 3, 3, 4], "Marketing Manager": [4, 4, 4, 5, 4, 4, 4],
    "Data Analyst": [3, 5, 3, 3, 4, 4, 4], "Analytics Lead": [4, 5, 4, 4, 4, 5, 4],
    "Operations Coordinator": [3, 3, 4, 3, 4, 4, 4], "Operations Manager": [4, 4, 5, 4, 4, 5, 4],
    "People Operations Specialist": [3, 3, 3, 5, 4, 4, 4], "HR Business Partner": [4, 4, 3, 5, 4, 5, 4],
}


def sample_workforce_records(scenario="assistive"):
    """Forty fictional records, computed per role; kept in memory and never written as real assessments."""
    records = []
    # Four people for each of two roles in each department = 40.
    for dept_index, (department, roles) in enumerate(DEPARTMENTS.items()):
        for role_index, role in enumerate(roles):
            targets = ROLE_TARGETS[role]
            for person in range(4):
                key = f"SAMPLE-{dept_index + 1}{role_index + 1}{person + 1:02d}"
                assessed = {}
                for skill_index, skill in enumerate(SKILLS):
                    required = targets[skill_index]
                    # A deterministic, varied spread gives a realistic demonstration matrix.
                    offset = (dept_index * 2 + role_index + person * 2 + skill_index * 3) % 6
                    current = max(0, min(5, required - (offset - 2)))
                    if scenario == "agentic" and skill in {"AI literacy", "Workflow automation"}:
                        required = min(5, required + 1)
                    assessed[skill] = {"current": current, "required": required, "category": "tool" if skill == "Digital tools" else "skill"}
                records.append({"key": key, "department": department, "role": role, "skills": assessed})
    return records


def load_reports(con, owner: str, scenario: str, sample_preview: bool = False) -> list[dict]:
    """Latest stored report per person in this HR's organisation, from two sources:
    the employee's own resume/quiz analysis (an active employee this HR invited) and HR's team uploads
    (tagged with this HR as owner, or untagged older uploads, which the review queue already shows to HR).
    Sample previews use fictional memory-only data."""
    if sample_preview:
        return sample_workforce_records(scenario)
    from governance.db import json_text
    members = {r[0] for r in con.execute("SELECT employee_id FROM users WHERE invited_by=? AND role='employee' AND status='active'", (owner,)) if r[0]}
    owner_expr = json_text(con, json_text(con, "r.report", "workforce"), "owner")
    rows = con.execute(f"""SELECT p.plan_id, p.subject_id, p.audience, r.report, v.snapshot
        FROM plans p JOIN plan_reports r ON r.plan_id=p.plan_id JOIN plan_versions v ON v.plan_id=p.plan_id
        LEFT JOIN plan_references ref ON ref.plan_id=p.plan_id
        WHERE v.version=(SELECT max(version) FROM plan_versions WHERE plan_id=p.plan_id)
        AND NOT EXISTS (SELECT 1 FROM hr_reviews h WHERE h.plan_id=p.plan_id AND (h.deleted_utc IS NOT NULL OR h.archived=1))
        AND ((p.audience='hr' AND ({owner_expr}=? OR {owner_expr} IS NULL)) OR
             (p.audience='individual' AND EXISTS (SELECT 1 FROM users u
              WHERE u.employee_id=p.subject_id AND u.role='employee' AND u.status='active' AND u.invited_by=?)))
        ORDER BY p.created_utc DESC, ref.number DESC, p.plan_id DESC""", (owner, owner)).fetchall()
    latest = {}
    for pid, subject, audience, raw, snapshot in rows:
        try:
            report, plan = json.loads(raw), json.loads(snapshot)
        except (ValueError, TypeError):
            continue
        meta = report.get("workforce") or {}
        if meta.get("source") == "sample" or (report.get("request") or {}).get("scenario", plan.get("scenario")) != scenario:
            continue
        if audience == "hr" and meta.get("owner") not in (owner, None):
            continue
        # an upload's ids come from HR's file and can collide with account ids, so uploads key separately
        key = subject if audience == "individual" else meta.get("employee_key") or f"upload:{subject}"
        if not key:
            continue
        latest.setdefault(key, {"key": key, "role": (report.get("occupation") or {}).get("title") or plan.get("target_role", "Assigned role"),
                               "department": meta.get("department") or "Unassigned", "report": report, "plan": plan, "plan_id": pid,
                               "source": "employee" if audience == "individual" else "hr_upload"})
    return list(latest.values())


def _levels(gap, report):
    current, required = gap.get("current_level"), gap.get("required_level")
    if not all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) and 0 <= n <= 5 for n in (current, required)) or required == 0:
        return None, None
    assessed = gap.get("assessed")
    if assessed is None:
        explicit = {str(s.get("name", "")).casefold() for s in (report.get("request") or {}).get("skills", [])}
        assessed = current > 0 or str(gap.get("skill_id", "")).casefold() in explicit
    return (float(current) if assessed else None), float(required)


def severity(percent):
    return "low" if percent < 25 else "moderate" if percent < 50 else "high" if percent < 75 else "critical"


def _normalize(records):
    normalized = []
    for record in records:
        if "skills" in record:
            normalized.append(record)
            continue
        skills = {}
        report = record["report"]
        seen = set()
        for gap in report.get("gaps") or []:
            name = gap.get("skill_id")
            if not name or name in seen:
                continue
            seen.add(name)
            current, required = _levels(gap, report)
            if required is not None:
                skills[name] = {"current": current, "required": required, "category": gap.get("kind", "skill")}
        normalized.append({**record, "skills": skills})
    return normalized


def aggregate(records, skills=(), category="all", sample_preview: bool = False, department="", role="", source="") -> dict:
    skills = set(skills)
    records = _normalize(records)
    counts = Counter(r.get("source", "hr_upload") for r in records)
    if source:
        records = [r for r in records if r.get("source", "hr_upload") == source]
    all_departments = sorted({r.get("department", "Unassigned") for r in records})
    if department:
        records = [r for r in records if r.get("department", "Unassigned") == department]
    if role:
        records = [r for r in records if r.get("role") == role]
    departments = sorted({r.get("department", "Unassigned") for r in records})
    roles = sorted({r.get("role", "Assigned role") for r in records})
    # no departments recorded (employee self-analyses, older uploads): compare roles instead of one "Unassigned" column
    by_role = department or departments == ["Unassigned"]
    groups = ([{"key": r, "label": r, "kind": "role"} for r in roles] if by_role else
              [{"key": d, "label": d, "kind": "department"} for d in departments])
    available = {}
    for record in records:
        for name, item in record["skills"].items():
            available.setdefault(name, item.get("category", "skill"))
    shown = sorted(name for name, kind in available.items() if (not skills or name in skills) and (category == "all" or kind == category))
    rows, common = [], Counter()
    for name in shown:
        cells = []
        for group in groups:
            cohort = [r for r in records if (r.get("role") == group["key"] if group["kind"] == "role" else r.get("department", "Unassigned") == group["key"])]
            observations = [(r, r["skills"][name]) for r in cohort if name in r["skills"] and r["skills"][name].get("current") is not None]
            eligible = sum(name in r["skills"] for r in cohort)
            assessed = len(observations)
            status = "not_required" if not eligible else "missing" if not assessed else "ready"
            affected = sum(item["current"] < item["required"] for _, item in observations)
            percent = round(affected / assessed * 100) if assessed else None
            cell = {"skill": name, "category": available[name], "group": group["label"], "group_kind": group["kind"],
                    "department": department if department else (group["key"] if group["kind"] == "department" else next((r.get("department") for r in cohort), "Unassigned")),
                    "role": group["key"] if group["kind"] == "role" else (roles[0] if len(roles) == 1 else None),
                    "status": status, "employees": assessed, "eligible": eligible, "coverage": round(assessed / eligible * 100, 1) if eligible else 0,
                    "gap_percent": percent, "affected": affected, "severity": severity(percent) if percent is not None else None,
                    "current": round(sum(item["current"] for _, item in observations) / assessed, 1) if assessed else None,
                    "required": round(sum(item["required"] for _, item in observations) / assessed, 1) if assessed else None,
                    "roles": sorted({r.get("role") for r, _ in observations}), "topics": [],
                    "actions": [f"Schedule guided practice in {name} and reassess against role requirements."], "recommendation_source": "general_guidance"}
            cells.append(cell)
            if assessed:
                common[name] += affected
        rows.append({"skill": name, "category": available[name], "cells": cells,
                     "max_gap": max((c["gap_percent"] or 0 for c in cells), default=0)})
    # most-assessed skills first (real reports list different skills per role), then the biggest gap
    rows.sort(key=lambda item: (-sum(c["employees"] for c in item["cells"]), -item["max_gap"], item["skill"]))
    total_rows = len(rows)
    if not skills:
        rows = rows[:TOP_SKILLS]
    displayed = [c for row in rows for c in row["cells"]]
    assessed_skills = sum(any(c["employees"] for c in row["cells"]) for row in rows)
    visible_skills = set(shown)
    employee_count = len({r["key"] for r in records if any(name in visible_skills and item.get("current") is not None for name, item in r["skills"].items())})
    priorities = sorted((c for c in displayed if c["gap_percent"]), key=lambda c: (-c["gap_percent"], -c["affected"], c["skill"]))[:3]
    return {"overview": {"employees": employee_count, "assessed_skills": assessed_skills,
                         "critical": sum(c["severity"] == "critical" for c in displayed),
                         "common_missing": [{"skill": n, "employees": count} for n, count in common.most_common(3) if count]},
            "options": {"departments": all_departments,
                        "roles": sorted({r.get("role", "Assigned role") for r in records}),
                        "skills": [{"name": n, "category": kind} for n, kind in sorted(available.items())]},
            "groups": groups, "skills": [r["skill"] for r in rows], "rows": rows, "cells": displayed, "priorities": priorities,
            "cohort": {"employees": len(records), "department": department or "All departments", "role": role or "All roles"},
            "sources": [{"key": k, "label": label, "employees": counts.get(k, 0)} for k, label in SOURCES.items()],
            "total_skills": total_rows,
            "policy": {"min_group": MIN_GROUP, "min_coverage_percent": MIN_COVERAGE * 100, "scale": "0–5",
                       "source": "Latest authorized assessments; skill gaps count employees below their role-specific target.",
                       "sample_preview": sample_preview,
                       "notice": "SAMPLE DATA — 40 fictional workforce records for preview only; values do not represent a real workforce." if sample_preview else None}}
