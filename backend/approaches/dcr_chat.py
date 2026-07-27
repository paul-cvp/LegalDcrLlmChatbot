"""DCR chat approach."""

from approaches.chat_interface import ChatWithHistory


class DcrChat(ChatWithHistory):
    """just dcr no llm."""

    def __init__(self) -> None:
        super().__init__()
        self._trace = []
    
    @property
    def trace(self) -> list[str]:
        return self._trace
    
    def get_trace(self) -> list[str]:
        return []

    def delete_trace(self) -> None:
        self._trace.clear()
