"""Document extraction orchestration."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from object.domain import LLMChatResponse
from object.errors import ExternalServiceError
from tools.llm import LlmTool


class DocumentsController:
    def __init__(self, llm_tool: LlmTool | None = None) -> None:
        self.llm_tool = llm_tool or LlmTool()

    async def create_response(
        self,
        document_text: str,
        response_factory: Callable[[str], Awaitable[Any]] | None = None,
    ) -> LLMChatResponse:
        try:
            return await self.llm_tool.create_response(
                document_text,
                response_factory=response_factory,
            )
        except Exception as exc:
            raise ExternalServiceError(
                "The configured language model request failed."
            ) from exc
