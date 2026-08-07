"""Provider-neutral language-model requests and response conversion."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from openai import AsyncOpenAI

from object.domain import (
    ChatHistoryEntry,
    ChatRequest,
    ChatResponse,
    LLMChatRequest,
    LLMSettings,
)
from tools.llms import BaseLlm, StructuredResponse
from tools.llms.azure_llm import AzureLlm
from tools.llms.local_llm import LocalLlm, LocalLlmSettings


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _required_environment_variable(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set.")
    return value


@lru_cache(maxsize=1)
def get_llm() -> BaseLlm:
    """Create the process-wide provider selected at application startup."""
    load_dotenv(PROJECT_ROOT / ".env")
    provider = os.getenv("LLM_PROVIDER", "local").strip().lower()
    if provider == "local":
        return LocalLlm(
            LocalLlmSettings(
                repository=_required_environment_variable("LOCAL_LLM_REPOSITORY"),
                filename=_required_environment_variable("LOCAL_LLM_FILENAME"),
            )
        )
    if provider == "azure":
        return AzureLlm(
            LLMSettings(
                endpoint=_required_environment_variable("AZURE_OPENAI_ENDPOINT"),
                deployment_name=_required_environment_variable(
                    "AZURE_OPENAI_DEPLOYMENT_NAME"
                ),
                api_key=_required_environment_variable("AZURE_OPENAI_API_KEY"),
            )
        )
    raise RuntimeError("LLM_PROVIDER must be either 'local' or 'azure'.")


class LlmTool:
    PROJECT_ROOT = PROJECT_ROOT
    PROMPTS_ROOT = PROJECT_ROOT / "backend" / "prompts"

    def __init__(
        self,
        instructions: str | None = None,
        settings: LLMSettings | None = None,
        client: AsyncOpenAI | None = None,
        llm: BaseLlm | None = None,
    ) -> None:
        if llm is not None and (settings is not None or client is not None):
            raise ValueError("Provide either llm or Azure settings/client, not both.")
        if settings is not None or client is not None:
            if settings is None:
                raise ValueError("Azure settings are required when injecting a client.")
            self.llm = AzureLlm(settings, client)
        else:
            self.llm = llm or get_llm()
        # Keep the legacy attributes available for injected Azure callers.
        self.settings = getattr(self.llm, "settings", None)
        self.client = getattr(self.llm, "client", None)
        self.instructions = instructions
        self._prompts = Environment(
            loader=FileSystemLoader(self.PROMPTS_ROOT),
            undefined=StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def render_template(self, template_name: str, **context: Any) -> str:
        """Render a prompt and fail clearly when required context is missing."""
        return self._prompts.get_template(template_name).render(**context).strip()

    async def complete_from_templates(
        self,
        system_template: str,
        user_template: str,
        *,
        system_context: dict[str, Any] | None = None,
        user_context: dict[str, Any] | None = None,
    ) -> str:
        """Render a system/user prompt pair and return the generated text."""
        instructions = self.render_template(
            system_template, **(system_context or {})
        )
        input_text = self.render_template(user_template, **(user_context or {}))
        response = await self.request(
            LLMChatRequest(text=input_text, instructions=instructions)
        )
        return self.response_text(response)

    async def request(
        self,
        input_request: LLMChatRequest,
        history: list[ChatHistoryEntry] | None = None,
    ) -> Any:
        instruct = input_request.instructions or self.instructions
        return await self.llm.request(
            input_request,
            history=history,
            default_instructions=instruct,
        )

    async def request_structured(
        self,
        input_text: str,
        instructions: str,
        response_model: type[StructuredResponse],
    ) -> StructuredResponse:
        """Return a validated response through either configured provider."""
        return await self.llm.request_structured(
            input_text,
            instructions,
            response_model,
        )

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
        return ChatResponse(text=self.response_text(response))

    @staticmethod
    def response_text(response: Any) -> str:
        """Extract non-empty text from a provider response."""
        text = (
            response
            if isinstance(response, str)
            else getattr(response, "output_text", None)
        )
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("The language model returned no text output.")
        return text.strip()
