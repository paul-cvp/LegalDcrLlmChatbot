import asyncio

from object.domain import LLMSettings
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
