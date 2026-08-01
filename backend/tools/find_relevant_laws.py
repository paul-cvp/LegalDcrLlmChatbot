from util.localdocumentsearch import (
    LocalDocumentSearch,
    SearchResult,
    get_local_document_search,
)


class FindRelevantLaws:
    """Retrieve relevant law excerpts without calling a remote service."""

    def __init__(self, search: LocalDocumentSearch | None = None):
        self.search = search or get_local_document_search()

    def find(self, query: str, top_k: int = 5) -> list[SearchResult]:
        return self.search.search(query, top_k=top_k)
