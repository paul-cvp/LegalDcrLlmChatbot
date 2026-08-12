"""HTTP routes for document-to-DCR extraction."""

from collections.abc import AsyncIterator
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from controller.documents_controller import DocumentsController
from object.domain import (
    ActivityQuestionRequest,
    ActivityQuestionsRequest,
    ActivityQuestionsResponse,
    ChatResponse,
    CitizenInformationRequest,
    DocumentExtractionPassRequest,
    DocumentListItem,
)
from object.errors import NotFoundError, ValidationError


router = APIRouter(prefix="/api/documents-to-dcr", tags=["Documents to DCR"])
controller = DocumentsController()


@router.get("/documents", response_model=list[DocumentListItem])
async def list_documents() -> list[DocumentListItem]:
    return controller.list_documents()


@router.get("/document", response_class=StreamingResponse)
async def get_document(filename: str) -> StreamingResponse:
    try:
        path = controller.get_document_path(filename)
    except ValidationError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    except NotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    async def content() -> AsyncIterator[bytes]:
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                yield chunk

    headers = {"Content-Disposition": f"inline; filename*=UTF-8''{quote(path.name)}"}
    return StreamingResponse(content(), media_type="application/pdf", headers=headers)


@router.post("/responses", response_model=ChatResponse)
async def create_response(request: DocumentExtractionPassRequest) -> ChatResponse:
    return await controller.create_response(request.text, request.phase)


@router.post("/citizen-information", response_model=ChatResponse)
async def create_citizen_information(request: CitizenInformationRequest) -> ChatResponse:
    return await controller.create_citizen_information(request.text, request.language)


@router.post("/activity-questions", response_model=ActivityQuestionsResponse)
async def create_activity_questions(
    request: ActivityQuestionsRequest,
) -> ActivityQuestionsResponse:
    try:
        return await controller.create_activity_questions(request.graph_xml)
    except ValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error


@router.post("/activity-question", response_model=ChatResponse)
async def create_activity_question(request: ActivityQuestionRequest) -> ChatResponse:
    try:
        return await controller.create_activity_question(
            request.graph_xml,
            request.event_id,
            request.label,
            request.role,
            request.description,
        )
    except ValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
