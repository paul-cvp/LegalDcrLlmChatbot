"""Document extraction orchestration."""

import logging
from pathlib import Path
from time import perf_counter

from object.domain import (
    ChatResponse,
    DocumentListItem,
    LLMChatRequest,
)
from object.errors import NotFoundError, ValidationError
from tools.llm import LlmTool
from util.localdocumentsearch import DEFAULT_DOCUMENTS_PATH

SYSTEM_PROMPT = """
You are a business process modelling expert, tasked with creating process models from legal documents.
"""

LOGGER = logging.getLogger("uvicorn.error")
PHASE_LABELS = {
    "entities": "Entities",
    "relations": "Relations",
    "data_time": "Data and Time",
}

LANGUAGE_NAMES = {
    "source": "the predominant language of the legal excerpts",
    "da": "Danish",
    "en": "English",
    "no": "Norwegian",
}

class DocumentsController:

    def __init__(self, documents_path: Path = DEFAULT_DOCUMENTS_PATH) -> None:
        self.llm_tool = LlmTool()
        self.documents_path = Path(documents_path)

    def list_documents(self) -> list[DocumentListItem]:
        """Return the PDF corpus using paths relative to the document root."""
        if not self.documents_path.is_dir():
            return []
        documents = [
            DocumentListItem(
                filename=path.relative_to(self.documents_path).as_posix(),
                title=path.stem,
            )
            for path in self.documents_path.rglob("*")
            if path.is_file() and path.suffix.lower() == ".pdf"
        ]
        return sorted(
            documents,
            key=lambda item: (item.title.casefold(), item.filename.casefold()),
        )

    def get_document_path(self, filename: str) -> Path:
        """Resolve a PDF without allowing callers to leave the corpus root."""
        if not filename.strip():
            raise ValidationError("A PDF filename is required.")
        root = self.documents_path.resolve()
        candidate = (root / filename).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as error:
            raise ValidationError("Invalid PDF filename.") from error
        if candidate.suffix.lower() != ".pdf":
            raise ValidationError("Only PDF documents can be opened.")
        if not candidate.is_file():
            raise NotFoundError(f"PDF document {filename!r} was not found.")
        return candidate

    async def create_response(
        self, document_text: str, phase: str | None = None
    ) -> ChatResponse:
        llm_chat_request = LLMChatRequest(text=document_text, instructions=SYSTEM_PROMPT)
        label = PHASE_LABELS.get(phase, phase or "Model")
        started = perf_counter()
        LOGGER.info("PDF-to-DCR: %s extraction started", label)
        try:
            response = await self.llm_tool.create_response(llm_chat_request)
        except Exception:
            LOGGER.exception("PDF-to-DCR: %s extraction failed", label)
            raise
        LOGGER.info(
            "PDF-to-DCR: %s extraction completed in %.1f seconds",
            label,
            perf_counter() - started,
        )
        return response

    async def create_citizen_information(
        self, law_text: str, language: str
    ) -> ChatResponse:
        """Generate a short fictional citizen case from selected law excerpts."""
        started = perf_counter()
        LOGGER.info("Citizen Information: generation started")
        try:
            text = await self.llm_tool.complete_from_templates(
                "citizen_information.system.jinja2",
                "citizen_information.user.jinja2",
                system_context={"language": LANGUAGE_NAMES[language]},
                user_context={"law_text": law_text},
            )
        except Exception:
            LOGGER.exception("Citizen Information: generation failed")
            raise
        cleaned = self._limit_words(" ".join(text.split()), 200)
        LOGGER.info(
            "Citizen Information: generation completed in %.1f seconds",
            perf_counter() - started,
        )
        return ChatResponse(text=cleaned)

    @staticmethod
    def _limit_words(text: str, limit: int) -> str:
        """Keep provider output within the public word limit."""
        return " ".join(text.split()[:limit])
