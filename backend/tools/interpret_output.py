from tools.llm import LlmTool


class InterpretOutput(LlmTool):
    '''
    Use the extra data related necessary output from the dcr graph together with outlines to interpret the output the user provided for the given input
    '''
    def __init__(self):
        super().__init__()
        pass