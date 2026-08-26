from object.domain import ChatHistoryEntry
from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.llm import LlmTool
from tools.tool_call import ToolCall
from util import util


class SummarizeCaseHistory(LlmTool):
    """Summarize a case from its record and retrieved legal evidence."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(settings=settings, client=client)

    async def get_summary(
        self,
        query: str,
        process_info: dict | None = None,
        *,
        graph: DcrGraph | None = None,
        user_info: str | None = None,
        graph_execution_trace: list[dict] | None = None,
        use_data: bool = True,
        chat_history: list[ChatHistoryEntry] | None = None,
        **kwargs,
    ) -> str:
        del kwargs
        trace_data = self._trace_data(graph_execution_trace) if use_data else []
        relevant_laws = self._tool_data(
            trace_data, graph, ToolCall.FIND_RELEVANT_LAWS
        )
        similar_cases = self._tool_data(
            trace_data, graph, ToolCall.FIND_SIMILAR_CASES
        )
        categorized_ids = {
            item.get("id") for item in relevant_laws + similar_cases
        }
        history = self._chat_history(chat_history)
        context = {
            "query": self._text(query),
            "process_info": self._valued_mapping(process_info),
            "user_info": self._text(user_info),
            "trace_data": [
                item for item in trace_data
                if item.get("id") not in categorized_ids
            ],
            "relevant_laws": relevant_laws,
            "similar_cases": similar_cases,
            "trace_data_available": use_data,
            "chat_history": history,
            "dcr_xml": util.export_xml(graph) if graph is not None else None,
        }
        return await self.complete_from_templates(
            "summarize_case.system.jinja2",
            "summarize_case.user.jinja2",
            system_context=context,
            user_context=context,
        )

    @classmethod
    def _trace_data(cls, trace: list[dict] | None) -> list[dict]:
        """Keep only executions containing an explicit data value."""
        return [
            item for item in trace or []
            if isinstance(item, dict) and cls._has_value(item.get("data"))
        ]

    @staticmethod
    def _tool_data(
        trace: list[dict],
        graph: DcrGraph | None,
        expected_tool: ToolCall,
    ) -> list[dict]:
        if graph is None:
            return []
        activity_ids = {
            activity.ID
            for activity in graph.elements
            if ToolCall.from_callable(getattr(activity, "tool_call", None))
            is expected_tool
        }
        return [item for item in trace if item.get("id") in activity_ids]

    @classmethod
    def _chat_history(
        cls, history: list[ChatHistoryEntry] | None
    ) -> list[dict]:
        return [
            entry.model_dump(mode="json")
            for entry in history or []
            if cls._has_value(entry.item)
        ]

    @classmethod
    def _valued_mapping(cls, value: dict | None) -> dict:
        return {
            key: item for key, item in (value or {}).items()
            if cls._has_value(item)
        }

    @staticmethod
    def _text(value: str | None) -> str | None:
        text = value.strip() if isinstance(value, str) else ""
        return text or None

    @staticmethod
    def _has_value(value) -> bool:
        if isinstance(value, str):
            return bool(value.strip())
        return value is not None and value != [] and value != {}
