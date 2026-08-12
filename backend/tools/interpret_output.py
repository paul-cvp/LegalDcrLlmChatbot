from object.domain import LLMChatRequest
from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrGraph
from tools.llm import LlmTool
from util import util

INSTRUCTIONS = """
Interpret the given information and create a relevant question to ask the user.
You are given details about a DCR Graph event that requires input from the user.
You must create a simple, appropriate and correct question to ask the user.
Use the language the user expects; if no language is given, use English.
"""

ROBOT_PERMISSION_INSTRUCTIONS = """
Write one brief, explicit yes-or-no question asking whether the Robot may execute
the activity. Use the language of the recent chat history, or English when it is
unclear. Mention the activity naturally and return only the permission question.
"""


class InterpretOutput(LlmTool):
    """Create a user-facing question for a DCR activity."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)

    async def get_question(self, act: DcrActivity, dcr: DcrGraph) -> str:
        if act.eventData is None:
            # Labels are the authoritative user-facing fallback for input-free events.
            return act.label
        return await self.get_activity_question(act, dcr)

    async def get_activity_question(self, act: DcrActivity, dcr: DcrGraph) -> str:
        """Always rewrite a Citizen or Caseworker activity as a question."""
        dcr_xml = util.export_xml(dcr)
        data_type = act.eventData.data_type.__name__ if act.eventData else "none"
        input_text = f"""Information about the event the question is about:
            event id : {act.ID}
            event label: {act.label}
            event role: {act.role}
            event expected data type for the answer: {data_type}
            {"event description: "+act.description if act.description else ""}

            The full Dcr Graph the event is from:
            dcr_xml={dcr_xml}
        """
        return self.response_text(await self.request_text(input_text))

    async def get_robot_permission_question(self, act: DcrActivity, history) -> str:
        """Create a concise permission question with enough activity context."""
        recent_history = "\n".join(
            f"{entry.chat_role}: {entry.item}" for entry in history
        ) or "No previous messages."
        input_text = f"""Robot activity:
id: {act.ID}
label: {act.label}
description: {act.description or ''}
role: {act.role}
current data: {act.data!r}

Recent chat history:
{recent_history}
"""
        return self.response_text(
            await self.request(
                LLMChatRequest(
                    text=input_text,
                    instructions=ROBOT_PERMISSION_INSTRUCTIONS,
                )
            )
        )
