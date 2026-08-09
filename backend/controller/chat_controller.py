"""Manage in-memory chat sessions and their configured approaches."""

from collections.abc import Callable
from uuid import UUID, uuid4

from approaches.chat_interface import ChatWithHistory
from approaches.dcr_chat import DcrChat
from approaches.llm_chat import LLMChat
from approaches.llm_dcr_controller import LLMDcrControllerChat
from approaches.llm_rag_chat import LLMRagChat
from object.domain import (
    ChatHistoryEntry,
    ChatOption,
    ChatSessionRequest,
    ChatSessionResponse,
    ChatType,
    DcrChatRequest,
    DcrChatResponse,
    DcrControllerChatResponse,
    RagChatResponse,
)
from object.errors import NotFoundError


class ChatController:
    APPROACHES: dict[ChatType, Callable[[], ChatWithHistory]] = {
        ChatType.TEST_CHAT: ChatWithHistory,
        ChatType.LLM_CHAT: LLMChat,
        ChatType.DCR_CHAT: DcrChat,
        ChatType.DCR_CONTROLLER_CHAT: LLMDcrControllerChat,
        ChatType.RAG_CHAT: LLMRagChat,
    }

    def __init__(self) -> None:
        self._sessions: dict[UUID, ChatWithHistory] = {}

    @staticmethod
    def available_approaches() -> list[ChatOption]:
        return [
            ChatOption(name=chat_type.name, value=chat_type)
            for chat_type in ChatType
        ]

    def get_history(self, session_id: UUID) -> list[ChatHistoryEntry]:
        return self._get_session(session_id).get_history()

    def delete_session(self, session_id: UUID) -> None:
        if self._sessions.pop(session_id, None) is None:
            raise NotFoundError("Chat session not found.")

    @classmethod
    def _load_chat_approach(
        cls, chat_type: ChatType, graph_xml: str | None = None
    ) -> ChatWithHistory:
        approach = cls.APPROACHES[chat_type]
        if ChatType.DCR_CHAT == chat_type:
            from pm4py.objects.dcr.importer import importer as dcr_importer
            dcr_graph = dcr_importer.deserialize(
                graph_xml, variant=dcr_importer.DCR_JS_PORTAL
            )
            return approach(dcr_graph)
        else:
            return approach()

    def _get_session(self, session_id: UUID) -> ChatWithHistory:
        try:
            return self._sessions[session_id]
        except KeyError as exc:
            raise NotFoundError("Chat session not found.") from exc

    async def create_response(
        self, request: ChatSessionRequest|DcrChatRequest
    ) -> (
        ChatSessionResponse
        | DcrChatResponse
        | DcrControllerChatResponse
        | RagChatResponse
    ):
        if request.session_id is not None:
            session_id = request.session_id
            chat = self._get_session(session_id)
        else:
            session_id = uuid4()
            assert request.chat_type is not None
            graph_xml = (
                request.graph_xml if isinstance(request, DcrChatRequest) else None
            )
            chat = self._load_chat_approach(request.chat_type, graph_xml)

        response = await chat.run(request)
        if request.session_id is None:
            # Only successful first responses register a session.
            self._sessions[session_id] = chat
        if isinstance(response, ChatSessionResponse):
            response.session_id = session_id
            return response
        return ChatSessionResponse(text=response.text, session_id=session_id)
