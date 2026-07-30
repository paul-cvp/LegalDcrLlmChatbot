"""HTTP routes for document-to-DCR extraction."""

from fastapi import APIRouter, HTTPException, status

from controller.documents_controller import DocumentsController
from object.domain import ChatResponse, LLMChatRequest


router = APIRouter(prefix="/api/documents-to-dcr", tags=["Documents to DCR"])
controller = DocumentsController()


@router.post("/responses", response_model=ChatResponse)
async def create_response(request: LLMChatRequest) -> ChatResponse:
    return await controller.create_response(request.text)

