import asyncio
from types import SimpleNamespace

import pytest

from object.domain import LLMSettings
from tools.interpret_input import (
    BooleanValue,
    IntegerValue,
    InterpretInput,
    StringValue,
)


class FakeResponses:
    def __init__(self, value):
        self.value = value
        self.arguments = None

    async def parse(self, **arguments):
        self.arguments = arguments
        parsed = arguments["text_format"](value=self.value)
        return SimpleNamespace(output_parsed=parsed)


class FakeClient:
    def __init__(self, value):
        self.responses = FakeResponses(value)


@pytest.mark.parametrize(
    ("data_type", "raw_value", "response_model", "expected"),
    [
        (bool, True, BooleanValue, True),
        (int, 42, IntegerValue, 42),
        (str, "matched", StringValue, "matched"),
    ],
)
def test_interpret_input_uses_structured_wrapper_model(
    data_type, raw_value, response_model, expected
):
    client = FakeClient(raw_value)
    settings = LLMSettings(
        endpoint="https://example.invalid",
        deployment_name="test-model",
        api_key="test-key",
    )
    tool = InterpretInput(settings=settings, client=client)

    result = asyncio.run(tool.get_closest_match("input", data_type))

    assert result == expected
    assert type(result) is data_type
    assert client.responses.arguments["text_format"] is response_model
    assert client.responses.arguments["model"] == "test-model"


def test_interpret_input_rejects_unsupported_type():
    tool = InterpretInput.__new__(InterpretInput)

    with pytest.raises(TypeError, match="Unsupported DCR input type"):
        asyncio.run(tool.get_closest_match("1.5", float))
