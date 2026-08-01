from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrGraph
from tools.llm import LlmTool
from util import util

INSTRUCTIONS = """
Interpret the given information and create a relevant question to ask the user.
You are given details about a DCR Graph event the event required input from the user.
You must create a simple, appropriate and correct question to ask the user.
You must create the question in the language the user expects, if no language is given then create the question in english.
"""

class InterpretOutput(LlmTool):
    '''
    Use the extra data related necessary output from the dcr graph together with outlines to interpret the output the user provided for the given input
    '''
    def __init__(self, settings=None, client=None):
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)


    async def get_question(self, act: DcrActivity, dcr: DcrGraph):
        dcr_xml = util.export_xml(dcr)
        input = f"""Information about the event the questions is about:
            event id : {act.ID}
            event label: {act.label}
            event role: {act.role}
            event expected data type for the answer: {act.eventData.data_type}

            The full Dcr Graph the event is from:
            dcr_xml={dcr_xml}
        """
        response = await self.client.responses.create(
            model=self.settings.deployment_name,
            instructions=self.instructions,
            input=input
            )
        return response.output_text