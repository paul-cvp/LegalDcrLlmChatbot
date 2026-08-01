from pydantic import BaseModel

from tools.llm import LlmTool

INSTRUCTIONS = """
Interpret the input text and match it to the closest value given the python data type
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
    '''
    Use the extra data related necessary input from the dcr graph together with outlines to interpret the input that should be asked to the user
    '''
    def __init__(self, settings=None, client=None):
        super().__init__(instructions=INSTRUCTIONS, settings=settings, client=client)

    async def get_closest_match(self, input_text, data_type):
        response_model = RESPONSE_MODELS.get(data_type)
        if response_model is None:
            raise TypeError(f"Unsupported DCR input type: {data_type!r}.")

        response = await self.client.responses.parse(
            model=self.settings.deployment_name,
            instructions=self.instructions,
            input=input_text,
            text_format=response_model,
        )

        return response.output_parsed.value
