from util.localcasesearch import (
    CaseOutcome,
    LocalCaseSearch,
    SimilarCaseClusters,
    SimilarCaseResult,
    get_local_case_search,
)


class FindSimilarCases:
    """Retrieve and group similar cases without remote services."""

    def __init__(self, search: LocalCaseSearch | None = None):
        self.search = search or get_local_case_search()

    def find(
        self,
        query: str,
        top_k: int = 5,
        outcome: CaseOutcome | str | None = None,
    ) -> list[SimilarCaseResult]:
        return self.search.search(query, top_k=top_k, outcome=outcome)

    def cluster(
        self, query: str, top_k_per_outcome: int = 5
    ) -> SimilarCaseClusters:
        return self.search.cluster(query, top_k_per_outcome=top_k_per_outcome)
