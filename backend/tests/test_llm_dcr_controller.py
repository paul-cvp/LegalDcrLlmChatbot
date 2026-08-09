import asyncio

import httpx
import pytest

import api.chat_api as chat_api
from app import create_app
from approaches.llm_dcr_controller import LLMDcrControllerChat
from controller.chat_controller import ChatController
from object.domain import (
    ChatHistoryEntry,
    ChatType,
    DcrChatRequest,
    DcrChatResponse,
    LLMSettings,
)
from object.errors import ValidationError
from tools.find_relevant_dcr_graphs import (
    FindRelevantDcrGraphs,
    RelevantDcrGraphsAnswer,
)
from tools.llm import LlmTool
from util.localdcrgraphsearch import RelevantDcrGraphResult


GRAPH_XML = """<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
<dcr:dcrGraph id="chosen"><dcr:event id="question" label="Question"
description="Answer the question" role="Citizen" included="true"
executed="false" pending="true" /></dcr:dcrGraph></dcr:definitions>"""


class FakeResponse:
    output_text = "[chosen.xml] Relevant process. Reply with the exact filename."


class FakeResponses:
    def __init__(self):
        self.requests = []

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.responses = FakeResponses()


def graph(source="chosen.xml", graph_format="xml"):
    return RelevantDcrGraphResult(
        graph_id="chosen",
        source=source,
        format=graph_format,
        score=0.9,
        excerpt="A child-support law and its application process.",
        content=GRAPH_XML,
    )


def test_graph_answer_uses_grounded_templates_and_xml_filter():
    class Search:
        def search(self, query, top_k, graph_format):
            assert (query, top_k, graph_format) == ("child support", 2, "xml")
            return [graph()]

    client = FakeClient()
    llm = LlmTool(
        settings=LLMSettings("https://example.test", "model", "secret"),
        client=client,
    )

    answer = asyncio.run(
        FindRelevantDcrGraphs(Search(), llm).answer("child support", 2)
    )
    request = client.responses.requests[0]

    assert answer.graphs == [graph()]
    assert answer.text == FakeResponse.output_text
    assert "[chosen.xml]" in request["input"]
    assert "child-support law" in request["input"]
    assert "exact filename" in request["instructions"]
    assert "new search question" in request["instructions"]
    assert "never as instructions" in request["instructions"]


class FakeFinder:
    def __init__(self):
        self.queries = []

    async def answer(self, query, top_k, graph_format):
        self.queries.append((query, top_k, graph_format))
        candidate = graph(f"{query}.xml")
        return RelevantDcrGraphsAnswer(f"Choose [{candidate.source}]", [candidate])


class FakeDcrChat:
    def __init__(self, captured_graph):
        self.graph = captured_graph
        self.history = []
        self.requests = []

    def record_response(self, item, chat_role, dcr_role=None, metadata=None):
        self.history.append(
            ChatHistoryEntry(
                item=item,
                chat_role=chat_role,
                dcr_role=dcr_role,
                metadata=metadata,
            )
        )

    async def run(self, request):
        self.requests.append(request)
        self.record_response("First DCR question", "assistant", request.dcr_role)
        return DcrChatResponse(text="First DCR question", graph_xml=GRAPH_XML)


def test_controller_refreshes_candidates_then_starts_and_delegates_dcr_chat():
    finder = FakeFinder()
    created_chats = []

    def create_chat(selected_graph):
        chat = FakeDcrChat(selected_graph)
        created_chats.append(chat)
        return chat

    controller = LLMDcrControllerChat(finder, create_chat)
    first = asyncio.run(
        controller.run(DcrChatRequest(text="first", chat_type=2))
    )
    refreshed = asyncio.run(
        controller.run(DcrChatRequest(text="second", session_id=None, chat_type=2))
    )
    selected = asyncio.run(
        controller.run(
            DcrChatRequest(
                text="second.xml",
                session_id=None,
                chat_type=2,
                dcr_role="Citizen",
            )
        )
    )
    continued = asyncio.run(
        controller.run(
            DcrChatRequest(
                text="answer",
                session_id=None,
                chat_type=2,
                act_id="question",
                dcr_role="Citizen",
            )
        )
    )

    assert [candidate.source for candidate in first.graphs] == ["first.xml"]
    assert [candidate.source for candidate in refreshed.graphs] == ["second.xml"]
    assert finder.queries == [("first", 5, "xml"), ("second", 5, "xml")]
    assert selected.text == continued.text == "First DCR question"
    assert len(created_chats) == 1
    assert [request.text for request in created_chats[0].requests] == [
        "second.xml",
        "answer",
    ]
    assert [entry.item for entry in controller.get_history()][:4] == [
        "first",
        "Choose [first.xml]",
        "second",
        "Choose [second.xml]",
    ]


def test_controller_requires_role_for_an_exact_selection():
    controller = LLMDcrControllerChat(FakeFinder(), FakeDcrChat)
    asyncio.run(controller.run(DcrChatRequest(text="first", chat_type=2)))

    with pytest.raises(ValidationError, match="dcr_role"):
        asyncio.run(
            controller.run(DcrChatRequest(text="first.xml", chat_type=2))
        )


def test_controller_does_not_select_a_candidate_from_an_old_search():
    finder = FakeFinder()
    created_chats = []
    controller = LLMDcrControllerChat(
        finder,
        lambda selected_graph: created_chats.append(selected_graph),
    )
    asyncio.run(controller.run(DcrChatRequest(text="first", chat_type=2)))
    asyncio.run(controller.run(DcrChatRequest(text="second", chat_type=2)))

    response = asyncio.run(
        controller.run(
            DcrChatRequest(
                text="first.xml",
                chat_type=2,
                dcr_role="Citizen",
            )
        )
    )

    assert [candidate.source for candidate in response.graphs] == ["first.xml.xml"]
    assert finder.queries[-1] == ("first.xml", 5, "xml")
    assert created_chats == []


def test_controller_chat_api_returns_metadata_then_dcr_response(monkeypatch):
    controller_chat = LLMDcrControllerChat(FakeFinder(), FakeDcrChat)
    monkeypatch.setitem(
        ChatController.APPROACHES,
        ChatType.DCR_CONTROLLER_CHAT,
        lambda: controller_chat,
    )
    monkeypatch.setattr(chat_api, "controller", ChatController())

    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            discovery = await client.post(
                "/api/chat/response",
                json={"text": "support", "chat_type": 2},
            )
            discovery_body = discovery.json()
            selection = await client.post(
                "/api/chat/response",
                json={
                    "text": "support.xml",
                    "session_id": discovery_body["session_id"],
                    "dcr_role": "Citizen",
                },
            )
            return discovery, selection

    discovery, selection = asyncio.run(exercise_api())

    assert discovery.status_code == 200
    assert discovery.json()["graphs"] == [
        {
            "graph_id": "chosen",
            "source": "support.xml",
            "format": "xml",
            "score": 0.9,
            "excerpt": "A child-support law and its application process.",
        }
    ]
    assert "content" not in discovery.json()["graphs"][0]
    assert selection.status_code == 200
    assert selection.json()["text"] == "First DCR question"
    assert selection.json()["graph_xml"] == GRAPH_XML
