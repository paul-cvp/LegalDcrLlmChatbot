from tools.llm import LlmTool


class InterpretInput(LlmTool):
    '''
    Use the extra data related necessary input from the dcr graph together with outlines to interpret the input that should be asked to the user
    '''
    def __init__(self):
        super().__init__()
        pass