from tools.llm import LlmTool


class SummarizeCaseHistory(LlmTool):
    '''
    Use the chat history and the optional trace history to summarize what has happened in this case.
    '''
    def __init__(self):
        super().__init__()
        pass