from object.domain import ChatHistoryEntry
from tools.llm import LlmTool
from util.localdocumentsearch import (
    LocalDocumentSearch,
    SearchResult,
    get_local_document_search,
)


class FindRelevantLaws:
    """Retrieve law excerpts locally and optionally synthesize an answer."""

    def __init__(
        self,
        search: LocalDocumentSearch | None = None,
        llm: LlmTool | None = None,
    ) -> None:
        self.search = search or get_local_document_search()
        self._llm = llm

    def find(self, query: str, top_k: int = 5) -> list[SearchResult]:
        return self.search.search(query, top_k=top_k)

    async def answer(
        self,
        query: str,
        process_info: dict | None = None,
        *,
        user_info: str | None = None,
        graph_execution_trace: list[dict] | None = None,
        use_data: bool = True,
        chat_history: list[ChatHistoryEntry] | None = None,
        top_k: int = 5,
        **kwargs,
    ) -> str:
        """Answer a legal question using only locally retrieved excerpts."""
        del kwargs
        sources = self.find(query, top_k)
        process_info = {
            key: value for key, value in (process_info or {}).items()
            if self._has_value(value)
        }
        history = [
            entry for entry in chat_history or []
            if self._has_value(entry.item)
        ]
        context = {
            "query": query,
            "process_info": process_info or None,
            "user_info": user_info.strip() if user_info and user_info.strip() else None,
            "trace_data": graph_execution_trace if use_data and graph_execution_trace else None,
            "trace_data_available": use_data,
            "chat_history": history or None,
            "sources": sources,
        }
        return await self._language_model.complete_from_templates(
            "relevant_laws_answer.system.jinja2",
            "relevant_laws_answer.user.jinja2",
            system_context=context,
            user_context=context,
        )

    @staticmethod
    def _has_value(value) -> bool:
        if isinstance(value, str):
            return bool(value.strip())
        return value is not None and value != [] and value != {}

    @property
    def _language_model(self) -> LlmTool:
        if self._llm is None:
            self._llm = LlmTool()
        return self._llm
