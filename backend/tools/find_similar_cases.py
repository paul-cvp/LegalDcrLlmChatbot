from tools.llm import LlmTool
from util.localcasesearch import (
    CaseOutcome,
    LocalCaseSearch,
    SimilarCaseClusters,
    SimilarCaseResult,
    get_local_case_search,
)


class FindSimilarCases:
    """Retrieve cases locally and optionally synthesize a comparison."""

    def __init__(
        self,
        search: LocalCaseSearch | None = None,
        llm: LlmTool | None = None,
    ) -> None:
        self.search = search or get_local_case_search()
        self._llm = llm

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

    async def answer(
        self,
        query: str,
        top_k: int = 5,
        top_k_per_outcome: int = 3,
    ) -> str:
        """Compare the current case with closest and outcome-grouped cases."""
        print("FindSimilarCases")
        closest = self.find(query, top_k)
        clusters = self.cluster(query, top_k_per_outcome)
        res = await self._language_model.complete_from_templates(
            "similar_cases_answer.system.jinja2",
            "similar_cases_answer.user.jinja2",
            user_context={
                "query": query,
                "closest": closest,
                "clusters": clusters,
            },
        )
        return res

    @property
    def _language_model(self) -> LlmTool:
        if self._llm is None:
            self._llm = LlmTool()
        return self._llm
