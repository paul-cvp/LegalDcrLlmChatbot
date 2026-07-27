"""Language-model-backed chat approach."""

from approaches.chat_interface import ChatWithHistory
from tools.llm import LlmTool


class LLMChat(ChatWithHistory):
    def __init__(self, llm_tool: LlmTool | None = None) -> None:
        super().__init__()
        self.llm_tool = llm_tool or LlmTool()

    async def run(self, message: str) -> str:
        response = await self.llm_tool.create_response(message)
        self.record_response(message, response.text)
        return response.text
