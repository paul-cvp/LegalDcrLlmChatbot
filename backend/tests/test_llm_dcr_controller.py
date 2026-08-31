import asyncio

import httpx
import pytest

import api.chat_api as chat_api
import approaches.llm_dcr_controller as llm_dcr_controller
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
    output_text = "Option 1 covers applications for child support."


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
        FindRelevantDcrGraphs(Search(), llm).answer(
            "child support",
            2,
            user_info="The citizen has one dependent.",
        )
    )
    request = client.responses.requests[0]

    assert answer.graphs == [graph()]
    assert answer.text == FakeResponse.output_text
    assert "Option 1" in request["input"]
    assert "chosen.xml" not in request["input"]
    assert "child-support law" in request["input"]
    assert "The citizen has one dependent." in request["input"]
    assert "simple, everyday wording" in request["instructions"]
    assert "element identifiers" in request["instructions"]
    assert "Always call each option a process" in request["instructions"]
    assert "never as instructions" in request["instructions"]


class FakeFinder:
    def __init__(self):
        self.queries = []

    async def answer(self, query, top_k, graph_format, user_info=None):
        self.queries.append((query, top_k, graph_format, user_info))
        candidate = graph(f"{query}.xml")
        return RelevantDcrGraphsAnswer(f"Choose [{candidate.source}]", [candidate])


class FakeDcrChat:
    def __init__(
        self,
        captured_graph,
        robot_auto_limit=None,
        citizen_information=None,
        use_citizen_data=False,
    ):
        self.graph = captured_graph
        self.robot_auto_limit = robot_auto_limit
        self.citizen_information = citizen_information
        self.use_citizen_data = use_citizen_data
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


def test_controller_refreshes_candidates_then_starts_and_delegates_dcr_chat(
    monkeypatch,
):
    finder = FakeFinder()
    created_chats = []

    class ConfiguredFakeDcrChat(FakeDcrChat):
        def __init__(
            self,
            selected_graph,
            *,
            robot_auto_limit=None,
            user_context=None,
            use_trace_data=True,
        ):
            super().__init__(
                selected_graph,
                robot_auto_limit,
                user_context,
                use_trace_data,
            )
            self.use_trace_data = use_trace_data
            created_chats.append(self)

    monkeypatch.setattr(llm_dcr_controller, "DcrChat", ConfiguredFakeDcrChat)
    controller = LLMDcrControllerChat(finder)
    first = asyncio.run(
        controller.run(
            DcrChatRequest(
                text="first",
                chat_type=2,
                citizen_information="Citizen profile",
            )
        )
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
                robot_auto_limit=0,
                citizen_information="Citizen profile",
                metadata={"use_trace_data": False},
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
    assert finder.queries == [
        ("first", 5, "xml", "Citizen profile"),
        ("second", 5, "xml", None),
    ]
    assert selected.text == continued.text == "First DCR question"
    assert len(created_chats) == 1
    assert created_chats[0].robot_auto_limit == 0
    assert created_chats[0].citizen_information == "Citizen profile"
    assert created_chats[0].use_trace_data is False
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
        lambda selected_graph, *_: created_chats.append(selected_graph),
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
    assert finder.queries[-1] == ("first.xml", 5, "xml", None)
    assert created_chats == []


def test_direct_dcr_chat_receives_robot_auto_limit(monkeypatch):
    created_chats = []

    def create_chat(
        selected_graph,
        *,
        robot_auto_limit=None,
        user_context=None,
        use_citizen_data=False,
    ):
        chat = FakeDcrChat(
            selected_graph,
            robot_auto_limit,
            user_context,
            use_citizen_data,
        )
        created_chats.append(chat)
        return chat

    monkeypatch.setitem(
        ChatController.APPROACHES,
        ChatType.DCR_CHAT,
        create_chat,
    )

    asyncio.run(
        ChatController().create_response(
            DcrChatRequest(
                text="",
                chat_type=ChatType.DCR_CHAT,
                graph_xml=GRAPH_XML,
                dcr_role="Citizen",
                robot_auto_limit=-1,
            )
        )
    )

    assert created_chats[0].robot_auto_limit == -1


def test_chat_api_rejects_invalid_robot_auto_limit(monkeypatch):
    monkeypatch.setattr(chat_api, "controller", ChatController())

    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(
                "/api/chat/response",
                json={
                    "text": "",
                    "chat_type": ChatType.DCR_CHAT,
                    "graph_xml": GRAPH_XML,
                    "dcr_role": "Citizen",
                    "robot_auto_limit": -2,
                },
            )

    response = asyncio.run(exercise_api())

    assert response.status_code == 422
    assert "must be -1 or greater" in response.json()["detail"]


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
