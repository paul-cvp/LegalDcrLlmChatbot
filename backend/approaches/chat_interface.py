"""Base chat interface and deterministic history-enabled implementation."""

from object.domain import ChatHistoryEntry, ChatRequest, ChatResponse


class Chat:
    async def run(self, request: ChatRequest | str) -> ChatResponse:

        normalized_request = self.normalize_request(request)

        return ChatResponse(text=normalized_request.text)

    @staticmethod
    def normalize_request(request: ChatRequest | str) -> ChatRequest:
        return request if isinstance(request, ChatRequest) else ChatRequest(text=request)


class ChatWithHistory:
    """Store successful request/response pairs in insertion order."""

    def __init__(self) -> None:
        self._history: list[ChatHistoryEntry] = []

    @property
    def history(self) -> list[ChatHistoryEntry]:
        return self._history

    async def run(self, request: ChatRequest | str) -> ChatResponse:
        normalized_request = self.normalize_request(request)

        response = ChatResponse(text=normalized_request.text)

        self.record_response(item=normalized_request, chat_role="user")
        self.record_response(item=response, chat_role="assistant")
        return response

    def record_response(
        self,
        item: str,
        chat_role: str,
        dcr_role: str = None
    ) -> None:
        self._history.append(
            ChatHistoryEntry(item=item, chat_role=chat_role, dcr_role=dcr_role)
        )

    def get_history(self) -> list[ChatHistoryEntry]:
        return list(self._history)

    def clear_history(self) -> None:
        self._history.clear()

    @staticmethod
    def normalize_request(request: ChatRequest | str) -> ChatRequest:
        return request if isinstance(request, ChatRequest) else ChatRequest(text=request)