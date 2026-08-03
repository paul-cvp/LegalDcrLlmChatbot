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

    async def answer(self, query: str, top_k: int = 5) -> str:
        """Answer a legal question using only locally retrieved excerpts."""
        print("FindRelevantLaws")
        sources = self.find(query, top_k)
        res = await self._language_model.complete_from_templates(
            "relevant_laws_answer.system.jinja2",
            "relevant_laws_answer.user.jinja2",
            user_context={"query": query, "sources": sources},
        )
        return res

    @property
    def _language_model(self) -> LlmTool:
        if self._llm is None:
            self._llm = LlmTool()
        return self._llm
