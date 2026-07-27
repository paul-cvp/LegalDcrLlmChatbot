"""Select and execute the configured chat approach."""

from collections.abc import Callable

from approaches.chat_interface import Chat, ChatWithHistory
from approaches.dcr_chat import DcrChat
from approaches.llm_chat import LLMChat
from approaches.llm_dcr_controller import LLMDcrControllerChat
from object.domain import (
    ChatOption,
    ChatRequest,
    ChatResponse,
    ChatType,
)


class ChatController:
    APPROACHES: dict[ChatType, Callable[[], Chat]] = {
        ChatType.TEST_CHAT: ChatWithHistory,
        ChatType.LLM_CHAT: LLMChat,
        ChatType.DCR_CHAT: DcrChat,
        ChatType.DCR_CONTROLLER_CHAT: LLMDcrControllerChat,
    }

    def __init__(self, chat_type: ChatType = ChatType.TEST_CHAT) -> None:
        self.select_approach(chat_type)

    @staticmethod
    def available_approaches() -> list[ChatOption]:
        return [
            ChatOption(name=chat_type.name, value=chat_type)
            for chat_type in ChatType
        ]

    def selected_approach(self) -> ChatOption:
        return ChatOption(name=self.chat_type.name, value=self.chat_type)

    def select_approach(self, chat_type: ChatType) -> ChatOption:

        self.chat_type = chat_type
        self.chat_approach = self._load_chat_approach(chat_type)
        return self.selected_approach()

    def get_history(self) -> list:
        return self.chat_approach.get_history()

    def clear_history(self) -> None:
        self.chat_approach.clear_history()

    @classmethod
    def _load_chat_approach(cls, chat_type: ChatType) -> Chat:
        try:
            approach = cls.APPROACHES[chat_type]
        except KeyError as exc:
            raise ValueError(f"Unsupported chat type: {chat_type}") from exc
        return approach()

    async def create_response(self, request: ChatRequest) -> ChatResponse:
        chat = self.chat_approach
        return ChatResponse(text=await chat.run(request.text))
