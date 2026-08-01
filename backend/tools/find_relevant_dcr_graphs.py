from util.localdcrgraphsearch import (
    LocalDcrGraphSearch,
    RelevantDcrGraphResult,
    get_local_dcr_graph_search,
)


class FindRelevantDcrGraphs:
    """Retrieve complete relevant DCR graphs without remote services."""

    def __init__(self, search: LocalDcrGraphSearch | None = None):
        self.search = search or get_local_dcr_graph_search()

    def find(self, query: str, top_k: int = 5) -> list[RelevantDcrGraphResult]:
        return self.search.search(query, top_k=top_k)
