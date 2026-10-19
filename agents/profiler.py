"""Normalize user skill names to dataset skill IDs (deterministic alias table)."""
from core.state import Profile, ValidationIssue

ALIASES = {"powerbi": "power bi", "power-bi": "power bi", "ms excel": "excel", "microsoft excel": "excel",
           "py": "python", "python3": "python", "postgres": "postgresql", "js": "javascript",
           "amazon web services": "aws", "google cloud": "gcp", "k8s": "kubernetes", "scikit learn": "scikit-learn",
           "sklearn": "scikit-learn", "ms sql": "sql server", "mssql": "sql server", "golang": "go",
           "ms word": "word", "ms powerpoint": "powerpoint", "pyspark": "spark", "torch": "pytorch"}


def normalize(name: str) -> str:
    n = " ".join(name.strip().lower().split())
    return ALIASES.get(n, n)


def profile_skills(profile: Profile, known: set[str]) -> tuple[dict[str, int], list[ValidationIssue]]:
    """-> {skill_id: level} (max level wins on duplicates) + warnings for skills outside the taxonomy."""
    levels, issues = {}, []
    for s in profile.skills:
        sid = normalize(s.name)
        levels[sid] = max(levels.get(sid, 0), s.level)
        if sid not in known:
            issues.append(ValidationIssue(code="unknown_skill", severity="warning", field="profile.skills",
                                          message=f"'{s.name}' is not in the job-ad skill taxonomy; kept but not scored."))
    return levels, issues
