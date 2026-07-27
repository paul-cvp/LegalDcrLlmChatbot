"""Centralized OpenAI configuration, requests, and response conversion."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import AsyncOpenAI

from object.domain import LLMChatResponse, LLMSettings


class LlmTool:
    PROJECT_ROOT = Path(__file__).resolve().parents[2]

    def __init__(
        self,
        settings: LLMSettings | None = None,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._settings = settings
        self._client = client

    @property
    def settings(self) -> LLMSettings:
        if self._settings is None:
            self._settings = self._load_settings()
        return self._settings

    @property
    def client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=self.settings.endpoint,
                api_key=self.settings.api_key,
            )
        return self._client

    async def request(self, input_text: str) -> Any:
        return await self.client.responses.create(
            model=self.settings.deployment_name,
            input=input_text,
        )

    async def create_response(
        self,
        input_text: str,
        response_factory: Callable[[str], Awaitable[Any]] | None = None,
    ) -> LLMChatResponse:
        factory = response_factory or self.request
        response = await factory(input_text)
        return LLMChatResponse(text=response.output_text)

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
