"""Shared Pydantic contracts - extend with team approval."""
from typing import Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints

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
    importance: float | None = None  # predicted importance 1-5 for the ESCO skill
    rationale_source_ids: list[str] = []


class PathwayActivity(BaseModel):
    day_range: Literal["1-30", "31-60", "61-90"]
    skill_id: str
    activity: str
    estimated_hours: float
    steps: list[Annotated[str, StringConstraints(max_length=400)]] = Field(default=[], max_length=6)  # what to do, in order
    outcome: Annotated[str, StringConstraints(max_length=400)] = ""  # what the person can show at the end
    evidence_ids: list[str] = []
    sdg_links: list[Annotated[str, StringConstraints(pattern=r"^SDG([1-9]|1[0-7])$")]] = []


class Pathway(BaseModel):
    target_role: str
    scenario: Literal["assistive", "agentic"]
    activities: list[PathwayActivity]
    deferred_skills: list[str] = []
    status: Literal["draft", "flagged", "approved"] = "draft"
