"""Base chat interface and deterministic test implementation."""

from object.domain import ChatHistoryEntry


class Chat:
    async def run(self, message: str) -> str:
        """Return the request unchanged."""
        return message

class ChatWithHistory(Chat):
    """Decorate a chat approach with ordered request/response history."""

    def __init__(self) -> None:
        self._history = []

    @property
    def history(self) -> list[ChatHistoryEntry]:
        return self._history

    async def run(self, message: str) -> str:
        response = await super().run(message)
        self.record_response(message, response)
        return response

    def record_response(self, request: str, response: str) -> None:
        self._history.append(ChatHistoryEntry(request=request, response=response))

    def get_history(self) -> list[ChatHistoryEntry]:
        return list(self._history)

    def clear_history(self) -> None:
        self._history.clear()
