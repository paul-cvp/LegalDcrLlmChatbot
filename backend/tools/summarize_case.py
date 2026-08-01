from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.llm import LlmTool
from util import util


class SummarizeCaseHistory(LlmTool):
    """Summarize a case from its record and retrieved legal evidence."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(settings=settings, client=client)

    async def get_summary(
        self,
        history: list,
        trace: list,
        legal_facts: list,
        similar_cases: list,
        dcr: DcrGraph,
    ) -> str:
        dcr_xml = util.export_xml(dcr)
        return await self.complete_from_templates(
            "summarize_case.system.jinja2",
            "summarize_case.user.jinja2",
            user_context={
                "history": history,
                "trace": trace,
                "legal_facts": legal_facts,
                "similar_cases": similar_cases,
                "dcr_xml": dcr_xml,
            },
        )
