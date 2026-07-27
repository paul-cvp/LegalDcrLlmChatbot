"""HTTP routes for document-to-DCR extraction."""

from fastapi import APIRouter, HTTPException, status

from controller.documents_controller import DocumentsController
from object.domain import LLMChatRequest, LLMChatResponse
from object.errors import ExternalServiceError

router = APIRouter(prefix="/api/documents-to-dcr", tags=["Documents to DCR"])
controller = DocumentsController()

# API dependency seam for replacing the external call in tests.
create_llm_response = controller.llm_tool.request


@router.post("/responses", response_model=LLMChatResponse)
async def create_response(request: LLMChatRequest) -> LLMChatResponse:
    try:
        return await controller.create_response(request.input, create_llm_response)
    except ExternalServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The configured language model request failed.",
        ) from error
