from typing import Any, Literal, Optional

from fastapi import APIRouter, Body
from pydantic import BaseModel, Field

from chatbot_service import answer_chat_message

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ScenarioContextPayload(BaseModel):
    scenario: Optional[str] = None
    district: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    limit: Optional[int] = None
    title: Optional[str] = None


class TravelContextPayload(BaseModel):
    origin_taluk_id: Optional[str] = None
    destination_taluk_id: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    has_result: bool = False


class RelocationContextPayload(BaseModel):
    taluk_id: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    has_report: bool = False


class CompareContextPayload(BaseModel):
    left_district: Optional[str] = None
    right_district: Optional[str] = None
    year: Optional[int] = None
    category: Optional[str] = None
    target_year: Optional[int] = None
    target_month: Optional[int] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    active_view: str = "map"
    language: str = "en"
    filters: dict[str, Any] = Field(default_factory=dict)
    history: list[ChatMessage] = Field(default_factory=list)
    scenario_context: Optional[ScenarioContextPayload] = None
    travel_context: Optional[TravelContextPayload] = None
    relocation_context: Optional[RelocationContextPayload] = None
    compare_context: Optional[CompareContextPayload] = None


@router.post("/ask")
def ask_chatbot(payload: ChatRequest = Body(...)):
    return answer_chat_message(
        message=payload.message,
        history=[item.model_dump() for item in payload.history],
        language=payload.language,
        context_payload={
            "active_view": payload.active_view,
            "filters": payload.filters,
            "scenario_context": payload.scenario_context.model_dump()
            if payload.scenario_context
            else None,
            "travel_context": payload.travel_context.model_dump()
            if payload.travel_context
            else None,
            "relocation_context": payload.relocation_context.model_dump()
            if payload.relocation_context
            else None,
            "compare_context": payload.compare_context.model_dump()
            if payload.compare_context
            else None,
        },
    )
