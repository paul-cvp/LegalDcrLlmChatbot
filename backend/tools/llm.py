"""Centralized OpenAI configuration, requests, and response conversion."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import AsyncOpenAI

from object.domain import (
    ChatHistoryEntry,
    ChatRequest,
    ChatResponse,
    LLMChatRequest,
    LLMSettings,
)


class LlmTool:
    PROJECT_ROOT = Path(__file__).resolve().parents[2]

    def __init__(
        self,
        instructions: str | None = None,
        settings: LLMSettings | None = None,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.settings = settings or self._load_settings()
        self.client = client or AsyncOpenAI(
                base_url=self.settings.endpoint,
                api_key=self.settings.api_key,
            )
        self.instructions = instructions

    async def request(
        self,
        input_request: LLMChatRequest,
        history: list[ChatHistoryEntry] | None = None,
    ) -> Any:
        instruct = input_request.instructions or self.instructions
        conversation = []
        if history:
            for entry in history:
                conversation.extend(
                    [
                        {"role": "user", "content": entry.request},
                        {"role": "assistant", "content": entry.response},
                    ]
                )
            conversation.append({"role": "user", "content": input_request.text})

        request_arguments = {
            "model": self.settings.deployment_name,
            "input": conversation if history else input_request.text,
        }
        if instruct:
            request_arguments["instructions"] = instruct
        return await self.client.responses.create(**request_arguments)

    async def request_text(self, input_text: str) -> Any:
        return await self.request(LLMChatRequest(text=input_text))

    async def create_response(
        self,
        input_request: LLMChatRequest | ChatRequest | str,
        history: list[ChatHistoryEntry] | None = None,
        response_factory: Callable[[str], Awaitable[Any]] | None = None,
    ) -> ChatResponse:
        if isinstance(input_request, str):
            input_request = LLMChatRequest(text=input_request)
        elif not isinstance(input_request, LLMChatRequest):
            input_request = LLMChatRequest(
                text=input_request.text,
                chat_type=input_request.chat_type,
            )

        response = (
            await response_factory(input_request.text)
            if response_factory is not None
            else await self.request(input_request, history)
        )
        return ChatResponse(text=response.output_text)

    def _load_settings(self) -> LLMSettings:
        load_dotenv(self.PROJECT_ROOT / ".env")
        return LLMSettings(
            endpoint=self._required_environment_variable("AZURE_OPENAI_ENDPOINT"),
            deployment_name=self._required_environment_variable(
                "AZURE_OPENAI_DEPLOYMENT_NAME"
            ),
            api_key=self._required_environment_variable("AZURE_OPENAI_API_KEY"),
        )

    @staticmethod
    def _required_environment_variable(name: str) -> str:
        value = os.getenv(name)
        if not value:
            raise RuntimeError(f"Required environment variable {name} is not set.")
        return value
