"""Shared interfaces for local and hosted language-model providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from object.domain import ChatHistoryEntry, LLMChatRequest


StructuredResponse = TypeVar("StructuredResponse", bound=BaseModel)


@dataclass(frozen=True)
class LlmResponse:
    """Provider-neutral text completion result."""

    output_text: str


class BaseLlm(ABC):
    """Contract implemented by every configured LLM backend."""

    @abstractmethod
    def ensure_available(self) -> None:
        """Validate and eagerly initialize the provider."""

    @abstractmethod
    async def request(
        self,
        input_request: LLMChatRequest,
        history: list[ChatHistoryEntry] | None = None,
        default_instructions: str | None = None,
    ) -> LlmResponse:
        """Generate a text response."""

    @abstractmethod
    async def request_structured(
        self,
        input_text: str,
        instructions: str,
        response_model: type[StructuredResponse],
    ) -> StructuredResponse:
        """Generate and validate a structured response."""
