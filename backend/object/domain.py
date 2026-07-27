"""Application domain objects shared by APIs and controllers."""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from pydantic import BaseModel, Field


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
    text: str = Field(min_length=1)
    chat_type: ChatType | None = None


class ChatResponse(BaseModel):
    text: str = Field(min_length=1)


class ChatHistoryEntry(BaseModel):
    request: str
    response: str


class ChatOption(BaseModel):
    name: str
    value: ChatType


class LLMChatRequest(BaseModel):
    input: str = Field(min_length=1)


class LLMChatResponse(BaseModel):
    text: str = Field(min_length=1)


class DcrChatRequest(ChatRequest):
    graph: DCRGraphHolder


class DcrChatResponse(ChatResponse):
    graph: DCRGraphHolder


class HealthResponse(BaseModel):
    status: str


@dataclass(frozen=True)
class LLMSettings:
    endpoint: str
    deployment_name: str
    api_key: str
