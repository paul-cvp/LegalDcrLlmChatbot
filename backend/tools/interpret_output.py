from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrGraph
from tools.llm import LlmTool
from util import util

INSTRUCTIONS = """
Interpret the given information and create a relevant question to ask the user.
You are given details about a DCR Graph event that requires input from the user.
You must create a simple, appropriate and correct question to ask the user.
Use the language the user expects; if no language is given, use English.
"""


class InterpretOutput(LlmTool):
    """Create a user-facing question for a DCR activity."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)

    async def get_question(self, act: DcrActivity, dcr: DcrGraph) -> str:
        if act.eventData is None:
            raise ValueError(f"Activity {act.ID!r} does not define event data.")
        dcr_xml = util.export_xml(dcr)
        input_text = f"""Information about the event the question is about:
            event id : {act.ID}
            event label: {act.label}
            event role: {act.role}
            event expected data type for the answer: {act.eventData.data_type.__name__}

            The full Dcr Graph the event is from:
            dcr_xml={dcr_xml}
        """
        return self.response_text(await self.request_text(input_text))
