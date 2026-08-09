"""Application domain objects shared by APIs and controllers."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Literal
from uuid import UUID
from pm4py.objects.dcr.ocdcr.obj import DcrGraph

from pydantic import AliasChoices, BaseModel, Field, model_validator


class DCRGraphHolder(BaseModel):
    name: str
    xml: str


class DCRGraphCreate(BaseModel):
    name: str
    xml: str


class DCRGraphUpdate(BaseModel):
    xml: str
    name: str | None = None


class ChatType(IntEnum):
    TEST_CHAT = -1
    LLM_CHAT = 0
    DCR_CHAT = 1
    DCR_CONTROLLER_CHAT = 2


class ChatRequest(BaseModel):
    text: str|int|bool
    chat_type: ChatType | None = None


class ChatResponse(BaseModel):
    text: str


class DocumentListItem(BaseModel):
    filename: str
    title: str


class ChatSessionRequest(ChatRequest):
    session_id: UUID | None = None

    @model_validator(mode="after")
    def validate_session_fields(self) -> ChatSessionRequest:
        if (self.chat_type is None) == (self.session_id is None):
            raise ValueError("Provide either chat_type or session_id, but not both.")
        return self


class SessionRequest(BaseModel):
    session_id: UUID | None = None


class ChatSessionResponse(ChatResponse):
    session_id: UUID | None = None


class DcrChatRequest(ChatSessionRequest):
    graph_xml: str | None = None
    act_id: str | None = None
    dcr_role: str | None = None


class DcrChatResponse(ChatSessionResponse):
    graph_xml: str | None = None
    act_id: str | None = None
    dcr_role: str | None = None

class ChatHistoryEntry(BaseModel):
    item: str
    chat_role: str
    dcr_role: str | None = None
    metadata: dict | None = None


class ChatOption(BaseModel):
    name: str
    value: ChatType


class LLMChatRequest(ChatRequest):
    text: str = Field(
        min_length=1,
        validation_alias=AliasChoices("text", "input"),
    )
    instructions: str | None = None


class DocumentExtractionPassRequest(LLMChatRequest):
    phase: Literal["entities", "relations", "data_time"] | None = None


class CitizenInformationRequest(BaseModel):
    text: str = Field(min_length=1)
    language: Literal["source", "da", "en", "no"] = "source"

@dataclass(frozen=True)
class LLMSettings:
    endpoint: str
    deployment_name: str
    api_key: str
