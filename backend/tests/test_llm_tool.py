import asyncio

import pytest
from jinja2 import UndefinedError

from object.domain import ChatHistoryEntry, LLMChatRequest, LLMSettings
from tools.llm import LlmTool


class FakeResponse:
    output_text = "generated text"


class FakeResponses:
    def __init__(self) -> None:
        self.requests = []

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return FakeResponse()


class FakeClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


def test_llm_tool_owns_request_configuration_and_response_conversion():
    settings = LLMSettings(
        endpoint="https://example.test",
        deployment_name="test-deployment",
        api_key="secret",
    )
    client = FakeClient()
    tool = LlmTool(settings=settings, client=client)

    response = asyncio.run(tool.create_response("hello"))

    assert response.text == "generated text"
    assert client.responses.requests == [
        {"model": "test-deployment", "input": "hello"}
    ]


def test_llm_tool_converts_chat_history_entries():
    settings = LLMSettings("https://example.test", "model", "secret")
    client = FakeClient()
    tool = LlmTool(settings=settings, client=client)

    asyncio.run(
        tool.request(
            LLMChatRequest(text="next"),
            [
                ChatHistoryEntry(item="question", chat_role="user"),
                ChatHistoryEntry(item="answer", chat_role="assistant"),
            ],
        )
    )

    assert client.responses.requests[0]["input"] == [
        {"role": "user", "content": "question"},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "next"},
    ]


def test_llm_tool_templates_are_strict():
    settings = LLMSettings("https://example.test", "model", "secret")
    tool = LlmTool(settings=settings, client=FakeClient())

    with pytest.raises(UndefinedError):
        tool.render_template("relevant_laws_answer.user.jinja2")


def test_llm_tool_rejects_empty_text_response():
    with pytest.raises(RuntimeError, match="no text output"):
        LlmTool.response_text(type("Response", (), {"output_text": " "})())
