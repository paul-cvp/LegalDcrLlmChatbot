from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.llm import LlmTool
from util import util

INSTRUCTIONS = """
Based on all the available information you must summarize the entire case.
You have the case chat history between the citizen, case worker and the dcr graph.
You also have the dcr graph describing the legal process.
You have the most relevant legal facts from the law.
You must take all the information and produce a summary of the case including
the legal facts and arguments that lead to this moment.
You must only summarize, do not invent decisions or laws. All legal facts must be
cited.
"""

class SummarizeCaseHistory(LlmTool):
    '''
    Use the chat history and the optional trace history 
    to summarize what has happened in this case.
    Use RAG from the documents index.
    Use RAG from the similar cases index.
    '''
    def __init__(self, settings=None, client=None):
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)


    async def get_summary(self, history: list, 
                          trace: list, 
                          legal_facts: list,
                          similar_cases: list, 
                          dcr: DcrGraph):
        dcr_xml = util.export_xml(dcr)
        input = f"""Information about the case to summarize:
            Case chat history : {history}
            Case process activity trace: {trace}
            Relevant legal facts: {legal_facts}
            Similar cases: {similar_cases}
            The full Dcr Graph of the process: {dcr_xml}

            Summarize this case in max 2 pages!
        """
        response = await self.client.responses.create(
            instructions=self.instructions,
            input=input
            )
        
        return response["content"]["text"]
