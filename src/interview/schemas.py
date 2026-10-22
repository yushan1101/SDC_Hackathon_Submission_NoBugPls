from typing import Literal

from pydantic import BaseModel, Field


class SkillInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    level: int = Field(ge=0, le=5)


class InterviewCreate(BaseModel):
    target_role: str = Field(min_length=1, max_length=60)
    skills: list[SkillInput] = Field(default_factory=list, max_length=40)
    difficulty: Literal["foundational", "intermediate", "advanced"] = "intermediate"
    plan_id: str | None = Field(default=None, max_length=40)
    transcript_consent: bool


class InterviewAnswer(BaseModel):
    question_id: str = Field(min_length=1, max_length=40)
    answer: str = Field(min_length=1, max_length=4000)


class InterviewEnd(BaseModel):
    pass
