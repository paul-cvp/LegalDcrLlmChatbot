import asyncio

import httpx

from app import create_app
from approaches.chat_interface import ChatWithHistory
from controller.chat_controller import ChatController
from object.domain import ChatRequest, ChatType


def test_chat_with_history_stores_ordered_request_response_pairs():
    chat = ChatWithHistory()

    asyncio.run(chat.run("first"))
    asyncio.run(chat.run("second"))

    assert [entry.model_dump() for entry in chat.get_history()] == [
        {"request": "first", "response": "first"},
        {"request": "second", "response": "second"},
    ]


def test_chat_controller_loads_test_interface_and_echoes_request():
    controller = ChatController(ChatType.TEST_CHAT)

    assert type(controller.chat_approach) is ChatWithHistory
    response = asyncio.run(controller.create_response(ChatRequest(text="hello")))
    assert response.text == "hello"


def test_chat_endpoint_uses_test_interface_by_default():
    async def post() -> httpx.Response:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post("/api/chat/response", json={"text": "hello"})

    response = asyncio.run(post())

    assert response.status_code == 200
    assert response.json() == {"text": "hello"}


def test_chat_controller_loads_all_approaches():
    expected_names = {
        ChatType.TEST_CHAT: "ChatWithHistory",
        ChatType.LLM_CHAT: "LLMChat",
        ChatType.DCR_CHAT: "DcrChat",
        ChatType.DCR_CONTROLLER_CHAT: "LLMDcrControllerChat",
    }

    for chat_type, class_name in expected_names.items():
        assert ChatController(chat_type).chat_approach.__class__.__name__ == class_name


def test_chat_api_lists_selects_and_uses_an_approach():
    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            options = await client.get("/api/chat/approaches")
            selected = await client.post(
                f"/api/chat/approach/{ChatType.DCR_CHAT.value}"
            )
            current = await client.get("/api/chat/approach")
            response = await client.post(
                "/api/chat/response", json={"text": "selected chat"}
            )
            await client.post(f"/api/chat/approach/{ChatType.TEST_CHAT.value}")
            return options, selected, current, response

    options, selected, current, response = asyncio.run(exercise_api())

    assert options.status_code == 200
    assert options.json() == [
        {"name": "TEST_CHAT", "value": -1},
        {"name": "LLM_CHAT", "value": 0},
        {"name": "DCR_CHAT", "value": 1},
        {"name": "DCR_CONTROLLER_CHAT", "value": 2},
    ]
    assert selected.json() == {"name": "DCR_CHAT", "value": 1}
    assert current.json() == selected.json()
    assert response.json() == {"text": "selected chat"}


def test_chat_history_stores_ordered_request_response_pairs_and_can_be_cleared():
    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            await client.delete("/api/chat/history")
            await client.post("/api/chat/response", json={"text": "first"})
            await client.post("/api/chat/response", json={"text": "second"})
            history = await client.get("/api/chat/history")
            cleared = await client.delete("/api/chat/history")
            empty_history = await client.get("/api/chat/history")
            return history, cleared, empty_history

    history, cleared, empty_history = asyncio.run(exercise_api())

    assert history.status_code == 200
    assert history.json() == [
        {"request": "first", "response": "first"},
        {"request": "second", "response": "second"},
    ]
    assert cleared.status_code == 204
    assert empty_history.json() == []
