import asyncio

from object.domain import ChatHistoryEntry, LLMSettings
from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrEventData, DcrGraph
from tools.interpret_output import INSTRUCTIONS, InterpretOutput


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


def test_interpret_output_uses_label_without_event_data():
    activity = DcrActivity("plain", label="Review application")
    tool = InterpretOutput.__new__(InterpretOutput)

    question = asyncio.run(tool.get_question(activity, DcrGraph("graph")))

    assert question == "Review application"


def test_activity_question_uses_existing_instructions_without_event_data():
    activity = DcrActivity(
        "review",
        label="Review application",
        description="Check whether the application is complete.",
        role="Caseworker",
    )
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    tool = InterpretOutput(settings=settings, client=client)

    question = asyncio.run(tool.get_activity_question(activity, DcrGraph("graph")))

    assert question == "How old is the child?"
    assert client.responses.arguments["instructions"] == INSTRUCTIONS
    assert "event role: Caseworker" in client.responses.arguments["input"]
    assert "event expected data type for the answer: none" in client.responses.arguments["input"]
    assert "Check whether the application is complete." in client.responses.arguments["input"]


def test_robot_permission_question_includes_activity_and_language_context():
    activity = DcrActivity(
        "notify",
        label="Send notification",
        description="Notify the citizen",
        role="Robot",
    )
    activity.data = "Ready"
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    tool = InterpretOutput(settings=settings, client=client)

    question = asyncio.run(
        tool.get_robot_permission_question(
            activity,
            [ChatHistoryEntry(item="Ja, tak", chat_role="user")],
        )
    )

    arguments = client.responses.arguments
    assert question == "How old is the child?"
    assert "id: notify" in arguments["input"]
    assert "label: Send notification" in arguments["input"]
    assert "description: Notify the citizen" in arguments["input"]
    assert "role: Robot" in arguments["input"]
    assert "current data: 'Ready'" in arguments["input"]
    assert "user: Ja, tak" in arguments["input"]
    assert "yes-or-no question" in arguments["instructions"]
