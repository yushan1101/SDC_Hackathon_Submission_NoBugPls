"""Shared Pydantic contracts - extend with team approval."""
from typing import Literal
from pydantic import BaseModel, Field

Audience = Literal["individual", "hr"]


class Skill(BaseModel):
    name: str
    level: int = Field(ge=0, le=5)


class Profile(BaseModel):
    skills: list[Skill]
    weekly_learning_hours: float = Field(gt=0, le=80)


class Request(BaseModel):
    request_id: str
    profile: Profile
    target_role: str
    scenario: Literal["assistive", "agentic"]
    query: str
    # dual use: an employee planning for themself, or an HR advisor reviewing a (pseudonymous) employee
    audience: Audience = "individual"
    employee_id: str | None = None


class Evidence(BaseModel):
    id: str
    title: str
    publication_date: str
    url: str
    excerpt: str
    publisher: str = ""
    access_date: str = ""
    category: str = ""
    license: str = ""


class ValidationIssue(BaseModel):
    code: str
    severity: Literal["warning", "error"]
    field: str
    message: str


class Gap(BaseModel):
    skill_id: str
    kind: Literal["skill", "tool"] = "skill"
    current_level: int = Field(ge=0, le=5)
    required_level: int = Field(ge=0, le=5)
    gap: int = Field(ge=0)
    importance: float | None = None  # O*NET importance 1-5 (None for tools)
    rationale_source_ids: list[str] = []


class PathwayActivity(BaseModel):
    day_range: Literal["1-30", "31-60", "61-90"]
    skill_id: str
    activity: str
    estimated_hours: float
    evidence_ids: list[str] = []
    sdg_links: list[Literal["SDG4", "SDG8"]] = []


class Pathway(BaseModel):
    target_role: str
    scenario: Literal["assistive", "agentic"]
    activities: list[PathwayActivity]
    deferred_skills: list[str] = []
    status: Literal["draft", "flagged", "approved"] = "draft"
