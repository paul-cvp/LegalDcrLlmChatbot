"""Azure OpenAI language-model provider."""

from __future__ import annotations

from openai import AsyncOpenAI
from pydantic import BaseModel

from object.domain import ChatHistoryEntry, LLMChatRequest, LLMSettings
from tools.llms import BaseLlm, LlmResponse, StructuredResponse


class AzureLlm(BaseLlm):
    """Use the OpenAI Responses API through an Azure endpoint."""

    def __init__(
        self,
        settings: LLMSettings,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.settings = settings
        self.client = client or AsyncOpenAI(
            base_url=settings.endpoint,
            api_key=settings.api_key,
        )

    def ensure_available(self) -> None:
        """Configuration is validated before this provider is constructed."""

    async def request(
        self,
        input_request: LLMChatRequest,
        history: list[ChatHistoryEntry] | None = None,
        default_instructions: str | None = None,
    ) -> LlmResponse:
        conversation = self._conversation(input_request.text, history)
        arguments = {
            "model": self.settings.deployment_name,
            "input": conversation if history else input_request.text,
        }
        instructions = input_request.instructions or default_instructions
        if instructions:
            arguments["instructions"] = instructions
        response = await self.client.responses.create(**arguments)
        return LlmResponse(self._response_text(response))

    async def request_structured(
        self,
        input_text: str,
        instructions: str,
        response_model: type[StructuredResponse],
    ) -> StructuredResponse:
        response = await self.client.responses.parse(
            model=self.settings.deployment_name,
            instructions=instructions,
            input=input_text,
            text_format=response_model,
        )
        parsed = getattr(response, "output_parsed", None)
        if not isinstance(parsed, BaseModel):
            raise RuntimeError("The language model returned no structured value.")
        return parsed

    @staticmethod
    def _conversation(
        input_text: str,
        history: list[ChatHistoryEntry] | None,
    ) -> list[dict[str, str]]:
        conversation = [
            {
                "role": "assistant" if entry.chat_role == "assistant" else "user",
                "content": entry.item,
            }
            for entry in history or []
        ]
        conversation.append({"role": "user", "content": input_text})
        return conversation

    @staticmethod
    def _response_text(response: object) -> str:
        text = getattr(response, "output_text", None)
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("The language model returned no text output.")
        return text.strip()
