from tools.llm import LlmTool


class FindRelevantLaws(LlmTool):
    '''
    #TODO: First retrieve relevant laws from the search index then use the llm to interpret the relevant laws 
    # before sending the evidence backed answer to the chat
    '''
    def __init__(self):
        super().__init__()
        pass