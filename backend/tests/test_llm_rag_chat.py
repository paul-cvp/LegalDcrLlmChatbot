import asyncio

import httpx
import pytest

from app import create_app
from approaches.llm_rag_chat import LLMRagChat
from controller.chat_controller import ChatController
from object.domain import (
    ChatRequest,
    ChatType,
    RagChatMetadata,
    RagSearchIndex,
)
from object.errors import ValidationError
from util.localcasesearch import CaseOutcome, SimilarCaseResult
from util.localdocumentsearch import SearchResult


class FakeFinder:
    def __init__(self, results):
        self.results = results
        self.calls = []

    def find(self, query, top_k):
        self.calls.append((query, top_k))
        return self.results


class FakeLlmTool:
    def __init__(self):
        self.requests = []

    def render_template(self, template, **context):
        if template.endswith("system.jinja2"):
            return f"grounded={context['grounded']}; followups={context['generate_followups']}"
        history = " | ".join(entry.item for entry in context["history"])
        evidence = " | ".join(item.citation for item in context["evidence"])
        return f"history={history}; query={context['query']}; evidence={evidence}"

    async def request_structured(self, input_text, instructions, response_model):
        self.requests.append((input_text, instructions, response_model))
        if "follow_up_questions" in response_model.model_fields:
            return response_model(
                answer="Grounded answer [law.pdf#page=2]",
                follow_up_questions=["First?", "Second?", "Third?"],
            )
        return response_model(answer="Answer")


def make_chat(laws=(), cases=()):
    llm = FakeLlmTool()
    law_finder = FakeFinder(laws)
    case_finder = FakeFinder(cases)
    return LLMRagChat(llm, law_finder, case_finder), llm, law_finder, case_finder


def test_rag_chat_searches_both_indexes_and_preserves_evidence():
    law = SearchResult("law", "law.pdf", 1, "Legal excerpt.", 0.9)
    case = SimilarCaseResult(
        "case", "case.json", 0, "Case excerpt.", 0.8, CaseOutcome.POSITIVE
    )
    chat, llm, laws, cases = make_chat([law], [case])
    metadata = RagChatMetadata(
        search_indexes=list(RagSearchIndex),
        generate_followups=True,
    )

    response = asyncio.run(chat.run(ChatRequest(text="Question", metadata=metadata)))

    assert laws.calls == [("Question", 5)]
    assert cases.calls == [("Question", 5)]
    assert response.follow_up_questions == ["First?", "Second?", "Third?"]
    followup_schema = llm.requests[0][2].model_json_schema()["properties"][
        "follow_up_questions"
    ]
    assert followup_schema == {
        "items": {"type": "string"},
        "maxItems": 3,
        "minItems": 3,
        "title": "Follow Up Questions",
        "type": "array",
    }
    assert [item.model_dump(mode="json") for item in response.evidence] == [
        {
            "index": "find_relevant_laws",
            "source": "law.pdf",
            "page": 2,
            "citation": "[law.pdf#page=2]",
            "excerpt": "Legal excerpt.",
            "score": 0.9,
            "outcome": None,
        },
        {
            "index": "find_similar_cases",
            "source": "case.json",
            "page": 1,
            "citation": "[case.json#page=1]",
            "excerpt": "Case excerpt.",
            "score": 0.8,
            "outcome": "positive",
        },
    ]


@pytest.mark.parametrize(
    ("selected", "law_calls", "case_calls"),
    [
        ([RagSearchIndex.RELEVANT_LAWS], 1, 0),
        ([RagSearchIndex.SIMILAR_CASES], 0, 1),
    ],
)
def test_rag_chat_uses_only_selected_index(selected, law_calls, case_calls):
    chat, _, laws, cases = make_chat()

    response = asyncio.run(
        chat.run(
            ChatRequest(
                text="Question",
                metadata=RagChatMetadata(search_indexes=selected),
            )
        )
    )

    assert len(laws.calls) == law_calls
    assert len(cases.calls) == case_calls
    assert response.follow_up_questions == []


def test_rag_chat_requires_metadata_but_allows_no_indexes():
    chat, llm, laws, cases = make_chat()

    with pytest.raises(ValidationError, match="metadata is required"):
        asyncio.run(chat.run(ChatRequest(text="Question")))

    response = asyncio.run(
        chat.run(ChatRequest(text="Question", metadata=RagChatMetadata()))
    )

    assert response.evidence == []
    assert response.follow_up_questions == []
    assert not laws.calls and not cases.calls
    assert "grounded=False" in llm.requests[0][1]


def test_rag_chat_passes_previous_turns_to_the_next_completion():
    chat, llm, _, _ = make_chat()
    request = lambda text: ChatRequest(text=text, metadata=RagChatMetadata())

    asyncio.run(chat.run(request("First")))
    asyncio.run(chat.run(request("Second")))

    assert "history=First | Answer" in llm.requests[1][0]
    assert [entry.item for entry in chat.history] == [
        "First",
        "Answer",
        "Second",
        "Answer",
    ]


def test_rag_chat_api_validates_metadata_and_serializes_response(monkeypatch):
    chat, _, _, _ = make_chat()
    monkeypatch.setitem(ChatController.APPROACHES, ChatType.RAG_CHAT, lambda: chat)

    async def exercise_api():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            missing = await client.post(
                "/api/chat/response",
                json={"text": "Question", "chat_type": ChatType.RAG_CHAT},
            )
            response = await client.post(
                "/api/chat/response",
                json={
                    "text": "Question",
                    "chat_type": ChatType.RAG_CHAT,
                    "metadata": {},
                },
            )
            return missing, response

    missing, response = asyncio.run(exercise_api())

    assert missing.status_code == 422
    assert response.status_code == 200
    assert response.json()["follow_up_questions"] == []
    assert response.json()["evidence"] == []


def test_controller_registers_rag_chat():
    assert ChatController.APPROACHES[ChatType.RAG_CHAT] is LLMRagChat
