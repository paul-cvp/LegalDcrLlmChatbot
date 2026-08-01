import asyncio

import pytest

from object.domain import LLMSettings
from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrEventData, DcrGraph
from tools.interpret_output import InterpretOutput


class FakeResponse:
    output_text = "How old is the child?"


class FakeResponses:
    def __init__(self):
        self.arguments = None

    async def create(self, **arguments):
        self.arguments = arguments
        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.responses = FakeResponses()


def test_interpret_output_uses_shared_request_handling():
    activity = DcrActivity("age", eventData=DcrEventData("age", int))
    graph = DcrGraph("graph", elements={activity})
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    tool = InterpretOutput(settings=settings, client=client)

    question = asyncio.run(tool.get_question(activity, graph))

    assert question == "How old is the child?"
    assert client.responses.arguments["model"] == "model"
    assert (
        "expected data type for the answer: int"
        in client.responses.arguments["input"]
    )


def test_interpret_output_requires_event_data():
    activity = DcrActivity("plain")
    tool = InterpretOutput.__new__(InterpretOutput)

    with pytest.raises(ValueError, match="does not define event data"):
        asyncio.run(tool.get_question(activity, DcrGraph("graph")))
