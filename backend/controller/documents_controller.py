"""Document extraction orchestration."""

import logging
from pathlib import Path
from time import perf_counter

from object.domain import (
    ActivityQuestionsResponse,
    ChatResponse,
    DocumentListItem,
    LLMChatRequest,
)
from object.errors import NotFoundError, ValidationError
from pm4py.objects.dcr.ocdcr.obj import DcrActivity
from tools.interpret_output import InterpretOutput
from tools.llm import LlmTool
from util import util
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

ALLOWED_ACTIVITY_ROLES = {"Citizen", "Caseworker", "Robot"}


class DocumentsController:

    def __init__(
        self,
        documents_path: Path = DEFAULT_DOCUMENTS_PATH,
        interpret_output: InterpretOutput | None = None,
    ) -> None:
        self.llm_tool = LlmTool()
        self.documents_path = Path(documents_path)
        self._interpret_output = interpret_output

    @property
    def interpret_output(self) -> InterpretOutput:
        """Create the finalizer only when From Text generation needs it."""
        if self._interpret_output is None:
            self._interpret_output = InterpretOutput()
        return self._interpret_output

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

    async def create_activity_questions(
        self, graph_xml: str
    ) -> ActivityQuestionsResponse:
        """Validate a generated process and rewrite its human activities."""
        graph = self._import_graph(graph_xml)

        activities = sorted(
            (
                element
                for element in graph.elements
                if isinstance(element, DcrActivity)
            ),
            key=lambda activity: activity.ID,
        )
        for activity in activities:
            if activity.role not in ALLOWED_ACTIVITY_ROLES:
                raise ValidationError(
                    f"Activity {activity.ID!r} has unsupported role {activity.role!r}."
                )
            if activity.role == "Citizen" and activity.eventData is None:
                raise ValidationError(
                    f"Citizen activity {activity.ID!r} must have event data."
                )

        questions = {}
        for activity in activities:
            if activity.role in {"Citizen", "Caseworker"}:
                questions[activity.ID] = await self.interpret_output.get_activity_question(
                    activity, graph
                )
        return ActivityQuestionsResponse(questions=questions)

    async def create_activity_question(
        self,
        graph_xml: str,
        event_id: str,
        label: str,
        role: str,
        description: str,
    ) -> ChatResponse:
        """Generate a question for one activity using the modal's current values."""
        graph = self._import_graph(graph_xml)
        activity = next(
            (
                element
                for element in graph.elements
                if isinstance(element, DcrActivity) and element.ID == event_id
            ),
            None,
        )
        if activity is None:
            raise ValidationError(f"Activity {event_id!r} was not found in the process.")

        activity.label = label.strip() or activity.label
        activity.role = role.strip() or None
        activity.description = description.strip() or None
        question = await self.interpret_output.get_activity_question(activity, graph)
        return ChatResponse(text=question)

    @staticmethod
    def _import_graph(graph_xml: str):
        try:
            return util.import_xml(graph_xml)
        except (SyntaxError, TypeError, ValueError) as error:
            raise ValidationError(f"Invalid process XML: {error}") from error

    @staticmethod
    def _limit_words(text: str, limit: int) -> str:
        """Keep provider output within the public word limit."""
        return " ".join(text.split()[:limit])
