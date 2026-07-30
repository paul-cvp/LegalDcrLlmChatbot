import asyncio
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import ValidationError

from app import create_app
from approaches.chat_interface import ChatWithHistory
from controller.chat_controller import ChatController
from object.domain import ChatSessionRequest, ChatType
from object.errors import NotFoundError


def test_chat_with_history_stores_ordered_request_response_pairs():
    chat = ChatWithHistory()

    asyncio.run(chat.run("first"))
    asyncio.run(chat.run("second"))

    assert [entry.model_dump() for entry in chat.get_history()] == [
        {"request": "first", "response": "first"},
        {"request": "second", "response": "second"},
    ]


def test_controller_creates_and_continues_an_isolated_session():
    controller = ChatController()
    first = asyncio.run(
        controller.create_response(
            ChatSessionRequest(text="first", chat_type=ChatType.TEST_CHAT)
        )
    )
    second = asyncio.run(
        controller.create_response(
            ChatSessionRequest(text="second", session_id=first.session_id)
        )
    )

    assert isinstance(first.session_id, UUID)
    assert second.session_id == first.session_id
    history = controller.get_history(first.session_id)
    assert [entry.model_dump() for entry in history] == [
        {"request": "first", "response": "first"},
        {"request": "second", "response": "second"},
    ]


def test_controller_keeps_session_histories_separate():
    controller = ChatController()
    first_session = asyncio.run(
        controller.create_response(
            ChatSessionRequest(text="first", chat_type=ChatType.TEST_CHAT)
        )
    )
    second_session = asyncio.run(
        controller.create_response(
            ChatSessionRequest(text="other", chat_type=ChatType.DCR_CHAT)
        )
    )

    assert first_session.session_id != second_session.session_id
    assert controller.get_history(first_session.session_id)[0].request == "first"
    assert controller.get_history(second_session.session_id)[0].request == "other"


def test_controller_deletes_the_session_and_its_history():
    controller = ChatController()
    response = asyncio.run(
        controller.create_response(
            ChatSessionRequest(text="hello", chat_type=ChatType.TEST_CHAT)
        )
    )

    controller.delete_session(response.session_id)

    with pytest.raises(NotFoundError):
        controller.get_history(response.session_id)
    with pytest.raises(NotFoundError):
        controller.delete_session(response.session_id)


@pytest.mark.parametrize(
    "data",
    [
        {"text": "hello"},
        {
            "text": "hello",
            "chat_type": ChatType.TEST_CHAT,
            "session_id": str(uuid4()),
        },
    ],
)
def test_session_request_requires_exactly_one_session_selector(data):
    with pytest.raises(ValidationError):
        ChatSessionRequest.model_validate(data)


def test_chat_controller_registers_all_approaches():
    assert {
        chat_type: approach.__name__
        for chat_type, approach in ChatController.APPROACHES.items()
    } == {
        ChatType.TEST_CHAT: "ChatWithHistory",
        ChatType.LLM_CHAT: "LLMChat",
        ChatType.DCR_CHAT: "DcrChat",
        ChatType.DCR_CONTROLLER_CHAT: "LLMDcrControllerChat",
    }


def test_chat_api_session_lifecycle_and_validation():
    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            options = await client.get("/api/chat/approaches")
            invalid = await client.post("/api/chat/response", json={"text": "hello"})
            first = await client.post(
                "/api/chat/response",
                json={"text": "first", "chat_type": ChatType.TEST_CHAT},
            )
            session_id = first.json()["session_id"]
            second = await client.post(
                "/api/chat/response",
                json={"text": "second", "session_id": session_id},
            )
            history = await client.post(
                "/api/chat/history", json={"session_id": session_id}
            )
            deleted = await client.request(
                "DELETE", "/api/chat/session", json={"session_id": session_id}
            )
            missing_history = await client.post(
                "/api/chat/history", json={"session_id": session_id}
            )
            missing_chat = await client.post(
                "/api/chat/response",
                json={"text": "third", "session_id": session_id},
            )
            missing_delete = await client.request(
                "DELETE", "/api/chat/session", json={"session_id": session_id}
            )
            return (
                options,
                invalid,
                first,
                second,
                history,
                deleted,
                missing_history,
                missing_chat,
                missing_delete,
            )

    (
        options,
        invalid,
        first,
        second,
        history,
        deleted,
        missing_history,
        missing_chat,
        missing_delete,
    ) = asyncio.run(exercise_api())

    assert options.status_code == 200
    assert options.json() == [
        {"name": "TEST_CHAT", "value": -1},
        {"name": "LLM_CHAT", "value": 0},
        {"name": "DCR_CHAT", "value": 1},
        {"name": "DCR_CONTROLLER_CHAT", "value": 2},
    ]
    assert invalid.status_code == 422
    assert first.status_code == 200
    assert UUID(first.json()["session_id"])
    assert first.json()["text"] == "first"
    assert second.json() == {
        "text": "second",
        "session_id": first.json()["session_id"],
    }
    assert history.json() == [
        {"request": "first", "response": "first"},
        {"request": "second", "response": "second"},
    ]
    assert deleted.status_code == 204
    assert missing_history.status_code == 404
    assert missing_chat.status_code == 404
    assert missing_delete.status_code == 404
