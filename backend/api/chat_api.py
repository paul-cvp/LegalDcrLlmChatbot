"""HTTP routes for chat requests."""

from fastapi import APIRouter, HTTPException, Response, status

from controller.chat_controller import ChatController
from object.domain import (
    ChatHistoryEntry,
    ChatOption,
    ChatSessionRequest,
    ChatSessionResponse,
    DcrChatResponse,
    DcrChatRequest,
    SessionRequest,
)
from object.errors import NotFoundError, ValidationError


router = APIRouter(prefix="/api/chat", tags=["Chat"])
controller = ChatController()


@router.get("/approaches", response_model=list[ChatOption])
@router.get("/options", response_model=list[ChatOption], include_in_schema=False)
async def get_chat_approaches() -> list[ChatOption]:
    return controller.available_approaches()


@router.post("/history", response_model=list[ChatHistoryEntry])
async def get_chat_history(request: SessionRequest) -> list[ChatHistoryEntry]:
    try:
        return controller.get_history(request.session_id)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_session(request: SessionRequest) -> Response:
    try:
        controller.delete_session(request.session_id)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/response", response_model=ChatSessionResponse|DcrChatResponse)
async def get_response(request: ChatSessionRequest|DcrChatRequest) -> ChatSessionResponse|DcrChatResponse:
    try:
        return await controller.create_response(request)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
