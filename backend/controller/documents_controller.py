"""Document extraction orchestration."""

from collections.abc import Awaitable, Callable
from typing import Any

from object.domain import ChatResponse, LLMChatRequest
from object.errors import ExternalServiceError
from tools.llm import LlmTool

SYSTEM_PROMPT = """
You are a business process modelling expert, tasked with creating process models from legal documents.
"""

class DocumentsController:

    def __init__(self) -> None:
        self.llm_tool = LlmTool()

    async def create_response(self, document_text: str) -> ChatResponse:
        llm_chat_request = LLMChatRequest(text=document_text, instructions=SYSTEM_PROMPT)
        return await self.llm_tool.create_response(llm_chat_request)
