"""Language-model-backed chat approach."""

from typing import override

from approaches.chat_interface import ChatWithHistory
from tools.llm import LlmTool
from object.domain import LLMChatRequest, ChatRequest, ChatResponse

class LLMChat(ChatWithHistory):
    def __init__(self, llm_tool: LlmTool | None = None) -> None:
        super().__init__()
        self.llm_tool = llm_tool or LlmTool()

    @override
    async def run(self, request: ChatRequest | str) -> ChatResponse:
        normalized_request = self.normalize_request(request)
        llm_message = LLMChatRequest(
            text=normalized_request.text,
            chat_type=normalized_request.chat_type,
        )
        response = await self.llm_tool.create_response(
            llm_message,
            history=self.get_history(),
        )
        self.record_response(normalized_request, response)
        return response
