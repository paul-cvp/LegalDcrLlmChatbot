"""Retrieval-augmented language-model chat approach."""

from typing import override

from pydantic import BaseModel, Field

from approaches.chat_interface import ChatWithHistory
from object.domain import (
    ChatRequest,
    RagChatMetadata,
    RagChatResponse,
    RagEvidence,
    RagSearchIndex,
)
from object.errors import ValidationError
from tools.find_relevant_laws import FindRelevantLaws
from tools.find_similar_cases import FindSimilarCases
from tools.llm import LlmTool


class _RagAnswer(BaseModel):
    answer: str = Field(min_length=1)


class _RagAnswerWithFollowups(_RagAnswer):
    follow_up_questions: list[str] = Field(min_length=3, max_length=3)


class LLMRagChat(ChatWithHistory):
    """Answer questions using the caller-selected local legal indexes."""

    def __init__(
        self,
        llm_tool: LlmTool | None = None,
        law_finder: FindRelevantLaws | None = None,
        case_finder: FindSimilarCases | None = None,
        top_k: int = 5,
    ) -> None:
        super().__init__()
        self.llm_tool = llm_tool or LlmTool()
        self.law_finder = law_finder or FindRelevantLaws()
        self.case_finder = case_finder or FindSimilarCases()
        self.top_k = top_k

    @override
    async def run(self, request: ChatRequest | str) -> RagChatResponse:
        normalized_request = self.normalize_request(request)
        if normalized_request.metadata is None:
            raise ValidationError("metadata is required for RAG chat requests.")
        if (
            not isinstance(normalized_request.text, str)
            or not normalized_request.text.strip()
        ):
            raise ValidationError("RAG chat questions must be non-empty text.")

        metadata = normalized_request.metadata
        evidence = self._retrieve(normalized_request.text, metadata)
        completion = await self._complete(normalized_request.text, metadata, evidence)
        followups = list(getattr(completion, "follow_up_questions", ()))
        response = RagChatResponse(
            text=completion.answer,
            follow_up_questions=followups,
            evidence=evidence,
        )
        # Store plain text so provider history remains serializable.
        self.record_response(
            normalized_request.text,
            "user",
            metadata=metadata.model_dump(mode="json"),
        )
        self.record_response(response.text, "assistant")
        return response

    def _retrieve(self, query: str, metadata: RagChatMetadata) -> list[RagEvidence]:
        evidence = []
        if RagSearchIndex.RELEVANT_LAWS in metadata.search_indexes:
            evidence.extend(
                self._as_evidence(result, RagSearchIndex.RELEVANT_LAWS)
                for result in self.law_finder.find(query, self.top_k)
            )
        if RagSearchIndex.SIMILAR_CASES in metadata.search_indexes:
            evidence.extend(
                self._as_evidence(result, RagSearchIndex.SIMILAR_CASES)
                for result in self.case_finder.find(query, self.top_k)
            )
        return evidence

    async def _complete(
        self,
        query: str,
        metadata: RagChatMetadata,
        evidence: list[RagEvidence],
    ) -> _RagAnswer:
        instructions = self.llm_tool.render_template(
            "rag_chat.system.jinja2",
            grounded=bool(metadata.search_indexes),
            generate_followups=metadata.generate_followups,
        )
        input_text = self.llm_tool.render_template(
            "rag_chat.user.jinja2",
            query=query,
            history=self.get_history(),
            evidence=evidence,
            indexes_selected=bool(metadata.search_indexes),
        )
        response_model = (
            _RagAnswerWithFollowups if metadata.generate_followups else _RagAnswer
        )
        return await self.llm_tool.request_structured(
            input_text,
            instructions,
            response_model,
        )

    @staticmethod
    def _as_evidence(result, index: RagSearchIndex) -> RagEvidence:
        page = result.page_number + 1
        outcome = getattr(result, "outcome", None)
        return RagEvidence(
            index=index,
            source=result.source,
            page=page,
            citation=f"[{result.source}#page={page}]",
            excerpt=result.text,
            score=result.score,
            outcome=getattr(outcome, "value", outcome),
        )
