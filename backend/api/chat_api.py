"""HTTP routes for chat requests."""

from fastapi import APIRouter, Response, status

from controller.chat_controller import ChatController
from object.domain import (
    ChatHistoryEntry,
    ChatOption,
    ChatRequest,
    ChatResponse,
    ChatType,
)


router = APIRouter(prefix="/api/chat", tags=["Chat"])
controller = ChatController()


@router.get("/approaches", response_model=list[ChatOption])
@router.get("/options", response_model=list[ChatOption], include_in_schema=False)
async def get_chat_approaches() -> list[ChatOption]:
    return controller.available_approaches()


@router.get("/approach", response_model=ChatOption)
async def get_selected_chat_approach() -> ChatOption:
    return controller.selected_approach()


@router.post("/approach/{chat_type}", response_model=ChatOption)
@router.put(
    "/approach/{chat_type}", response_model=ChatOption, include_in_schema=False
)
async def select_chat_approach(chat_type: ChatType) -> ChatOption:
    return controller.select_approach(chat_type)


@router.get("/history", response_model=list[ChatHistoryEntry])
async def get_chat_history() -> list[ChatHistoryEntry]:
    return controller.get_history()


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
async def clear_chat_history() -> Response:
    controller.clear_history()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/response", response_model=ChatResponse)
async def get_response(request: ChatRequest) -> ChatResponse:
    return await controller.create_response(request)
