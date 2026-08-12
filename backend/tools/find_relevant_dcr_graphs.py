from dataclasses import dataclass
from typing import Literal

from tools.llm import LlmTool
from util.localdcrgraphsearch import (
    LocalDcrGraphSearch,
    RelevantDcrGraphResult,
    get_local_dcr_graph_search,
)


@dataclass(frozen=True)
class RelevantDcrGraphsAnswer:
    text: str
    graphs: list[RelevantDcrGraphResult]


class FindRelevantDcrGraphs:
    """Retrieve complete relevant DCR graphs without remote services."""

    def __init__(
        self,
        search: LocalDcrGraphSearch | None = None,
        llm: LlmTool | None = None,
    ) -> None:
        self.search = search or get_local_dcr_graph_search()
        self._llm = llm

    def find(
        self,
        query: str,
        user_context: str | None = None,
        user_data: dict | None = None,
        top_k: int = 5,
        graph_format: Literal["xml", "json"] | None = None,
    ) -> list[RelevantDcrGraphResult]:
        if graph_format is None:
            return self.search.search(query, top_k=top_k)
        return self.search.search(query, top_k=top_k, graph_format=graph_format)

    async def answer(
        self,
        query: str,
        top_k: int = 5,
        graph_format: Literal["xml", "json"] | None = "xml",
        user_info: str | None = None,
    ) -> RelevantDcrGraphsAnswer:
        """Describe the retrieved graphs and retain them for exact selection."""
        graphs = self.find(query, top_k=top_k, graph_format=graph_format)
        text = await self._language_model.complete_from_templates(
            "relevant_dcr_graphs_answer.system.jinja2",
            "relevant_dcr_graphs_answer.user.jinja2",
            user_context={
                "query": query,
                "user_info": user_info,
                "graphs": graphs,
            },
        )
        return RelevantDcrGraphsAnswer(text=text, graphs=graphs)

    @property
    def _language_model(self) -> LlmTool:
        if self._llm is None:
            self._llm = LlmTool()
        return self._llm
