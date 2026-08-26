from object.domain import ChatHistoryEntry
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
        process_info: dict | None = None,
        *,
        user_info: str | None = None,
        graph_execution_trace: list[dict] | None = None,
        use_data: bool = True,
        chat_history: list[ChatHistoryEntry] | None = None,
        top_k: int = 5,
        top_k_per_outcome: int = 3,
        **kwargs,
    ) -> str:
        """Compare the current case with closest and outcome-grouped cases."""
        del kwargs
        closest = self.find(query, top_k)
        clusters = self.cluster(query, top_k_per_outcome)
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
            "closest": closest,
            "clusters": clusters,
            "has_cases": bool(
                closest or clusters.positive or clusters.negative or clusters.unknown
            ),
        }
        return await self._language_model.complete_from_templates(
            "similar_cases_answer.system.jinja2",
            "similar_cases_answer.user.jinja2",
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
