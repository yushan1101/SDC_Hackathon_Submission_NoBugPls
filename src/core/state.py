"""Shared Pydantic contracts - extend with team approval."""
from typing import Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints, model_validator

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


class LearningQuiz(BaseModel):
    question: Annotated[str, StringConstraints(max_length=500)]
    options: list[Annotated[str, StringConstraints(max_length=240)]] = Field(min_length=2, max_length=5)
    answer_index: int = Field(ge=0, le=4)
    explanation: Annotated[str, StringConstraints(max_length=700)]


class LearningNode(BaseModel):
    id: Annotated[str, StringConstraints(pattern=r"^week-\d{2}(?:-\d{2})?(?:-(?:practice|check))?$")]
    week_number: int = Field(ge=1, le=13)
    content_source: Literal["ai", "guided_fallback"] = "guided_fallback"
    title: Annotated[str, StringConstraints(min_length=4, max_length=120)]
    type: Literal["learn", "practice", "project", "review", "quiz"]
    skills: list[Annotated[str, StringConstraints(min_length=1, max_length=120)]] = Field(min_length=1, max_length=6)
    activity_keys: list[Annotated[str, StringConstraints(max_length=180)]] = Field(default=[], max_length=12)
    estimated_minutes: int = Field(ge=5, le=6000)
    learn_minutes: int = Field(default=0, ge=0, le=6000)
    practice_minutes: int = Field(default=0, ge=0, le=6000)
    quiz_minutes: int = Field(default=0, ge=0, le=6000)
    learning_objective: Annotated[str, StringConstraints(min_length=12, max_length=500)]
    topics: list[Annotated[str, StringConstraints(min_length=2, max_length=160)]] = Field(min_length=1, max_length=8)
    learn: list[Annotated[str, StringConstraints(max_length=1200)]] = Field(min_length=1, max_length=5)
    instructions: list[Annotated[str, StringConstraints(max_length=700)]] = Field(min_length=2, max_length=7)
    resource_ids: list[Annotated[str, StringConstraints(max_length=180)]] = Field(default=[], max_length=5)
    exercise: Annotated[str, StringConstraints(min_length=8, max_length=1000)]
    deliverable: Annotated[str, StringConstraints(min_length=4, max_length=500)]
    quiz: LearningQuiz | None = None
    completion_criteria: list[Annotated[str, StringConstraints(max_length=300)]] = Field(min_length=1, max_length=5)
    expected_outcome: Annotated[str, StringConstraints(min_length=8, max_length=500)]

    @model_validator(mode="after")
    def consistent_minutes(self):
        if not (self.learn_minutes or self.practice_minutes or self.quiz_minutes):
            self.learn_minutes = max(1, round(self.estimated_minutes * 0.35))
            self.quiz_minutes = max(1, round(self.estimated_minutes * 0.15)) if self.quiz else 0
            self.practice_minutes = self.estimated_minutes - self.learn_minutes - self.quiz_minutes
        if self.learn_minutes + self.practice_minutes + self.quiz_minutes != self.estimated_minutes:
            raise ValueError("learning step section minutes must add up to its total")
        if not self.quiz and self.quiz_minutes:
            raise ValueError("quiz minutes require a knowledge check")
        return self


class Pathway(BaseModel):
    target_role: str
    scenario: Literal["assistive", "agentic"]
    activities: list[PathwayActivity]
    learning_nodes: list[LearningNode] = Field(default=[], max_length=65)
    deferred_skills: list[str] = []
    status: Literal["draft", "flagged", "approved"] = "draft"
