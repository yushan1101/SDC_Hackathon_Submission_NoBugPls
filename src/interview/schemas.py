from typing import Literal

from pydantic import BaseModel, Field


class InterviewCreate(BaseModel):
    recommendation_id: str = Field(min_length=1, max_length=40)
    difficulty: Literal["foundational", "intermediate", "advanced"] = "intermediate"
    plan_id: str | None = Field(default=None, max_length=40)
    transcript_consent: bool


class InterviewPrefetch(BaseModel):
    recommendation_id: str = Field(min_length=1, max_length=40)
    difficulty: Literal["foundational", "intermediate", "advanced"] = "intermediate"


class InterviewAnswer(BaseModel):
    question_id: str = Field(min_length=1, max_length=40)
    answer: str = Field(min_length=1, max_length=4000)


class InterviewEnd(BaseModel):
    pass


class InterviewPause(BaseModel):
    draft_answer: str = Field(default="", max_length=4000)
