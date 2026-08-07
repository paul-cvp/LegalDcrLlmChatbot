"""Approved tool calls that may be persisted in DCR XML."""

from enum import Enum
from importlib import import_module


class ToolCall(str, Enum):
    FIND_RELEVANT_LAWS = "find_relevant_laws"
    FIND_SIMILAR_CASES = "find_similar_cases"
    SUMMARIZE_CASE_HISTORY = "summarize_case_history"

    @property
    def label(self) -> str:
        """Return the user-facing tool name served to editor clients."""
        return {
            self.FIND_RELEVANT_LAWS: "Find relevant laws",
            self.FIND_SIMILAR_CASES: "Find similar cases",
            self.SUMMARIZE_CASE_HISTORY: "Summarize case history",
        }[self]

    @property
    def target(self) -> str:
        """Return the lazily imported class method represented by this value."""
        return {
            self.FIND_RELEVANT_LAWS: (
                "tools.find_relevant_laws:FindRelevantLaws.answer"
            ),
            self.FIND_SIMILAR_CASES: (
                "tools.find_similar_cases:FindSimilarCases.answer"
            ),
            self.SUMMARIZE_CASE_HISTORY: (
                "tools.summarize_case:SummarizeCaseHistory.get_summary"
            ),
        }[self]

    async def __call__(self, *args, **kwargs):
        """Instantiate and invoke the approved tool only when it is needed."""
        module_name, qualified_name = self.target.split(":", 1)
        class_name, method_name = qualified_name.split(".", 1)
        owner = getattr(import_module(module_name), class_name)()
        return await getattr(owner, method_name)(*args, **kwargs)

    @classmethod
    def from_callable(cls, value):
        """Find the approved enum member matching a bound or plain method."""
        if isinstance(value, cls):
            return value
        function = getattr(value, "__func__", value)
        identity = (
            f"{getattr(function, '__module__', '')}:"
            f"{getattr(function, '__qualname__', '')}"
        )
        return next((tool for tool in cls if tool.target == identity), None)
