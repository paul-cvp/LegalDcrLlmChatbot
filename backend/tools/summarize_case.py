from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.llm import LlmTool
from util import util


class SummarizeCaseHistory(LlmTool):
    """Summarize a case from its record and retrieved legal evidence."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(settings=settings, client=client)

    async def get_summary(
        self,
        dcr: DcrGraph,
        user_info: str | None = None,
        user_data: dict | None = None,
    ) -> str:
        dcr_xml = util.export_xml(dcr)
        print(f"SummarizeCaseHistory {user_info} {user_data}")
        return await self.complete_from_templates(
            "summarize_case.system.jinja2",
            "summarize_case.user.jinja2",
            user_context={
                "user_info": user_info,
                "user_data": user_data,
                "dcr_xml": dcr_xml,
            },
        )
