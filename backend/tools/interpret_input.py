from pydantic import BaseModel

from tools.llm import LlmTool

'''
#TODO A few more details about the dcr graph are required perhaps, such as execution semantics,
notions about todays date and the trace, case history with past events that happened in the case.
'''
INSTRUCTIONS = """
Interpret the user's answer as the requested Python data type. Preserve the user's
meaning, do not add facts, and return only the structured value requested by the
response schema.
"""


class BooleanValue(BaseModel):
    value: bool


class IntegerValue(BaseModel):
    value: int


class StringValue(BaseModel):
    value: str


RESPONSE_MODELS = {
    bool: BooleanValue,
    int: IntegerValue,
    str: StringValue,
}


class InterpretInput(LlmTool):
    """Convert natural-language user input into a declared DCR data type."""

    def __init__(self, settings=None, client=None) -> None:
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)

    async def get_closest_match(self, input_text, data_type):
        response_model = RESPONSE_MODELS.get(data_type)
        if response_model is None:
            raise TypeError(f"Unsupported DCR input type: {data_type!r}.")

        parsed = await self.request_structured(
            input_text=(
                f"Expected Python type: {data_type.__name__}\n"
                f"User answer: {input_text}"
            ),
            instructions=self.instructions,
            response_model=response_model,
        )
        return parsed.value
