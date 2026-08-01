import asyncio
import json
from pathlib import Path

from object.domain import LLMSettings
from pm4py.objects.dcr.ocdcr.obj import DcrGraph
from tools.find_relevant_laws import FindRelevantLaws
from tools.find_similar_cases import FindSimilarCases
from tools.llm import LlmTool
from tools.summarize_case import SummarizeCaseHistory
from util.localcasesearch import (
    CaseOutcome,
    SimilarCaseClusters,
    SimilarCaseResult,
)
from util.localdocumentsearch import SearchResult


class FakeResponse:
    output_text = "grounded answer"


class FakeResponses:
    def __init__(self):
        self.requests = []

    async def create(self, **kwargs):
        self.requests.append(kwargs)
        return FakeResponse()


class FakeClient:
    def __init__(self):
        self.responses = FakeResponses()


def make_llm():
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    return LlmTool(settings=settings, client=client), client


def test_law_answer_uses_retrieved_source_and_human_page_number():
    source = SearchResult("chunk", "law.pdf", 1, "The legal excerpt.", 0.9)

    class Search:
        def search(self, query, top_k):
            assert (query, top_k) == ("What applies?", 2)
            return [source]

    llm, client = make_llm()
    answer = asyncio.run(
        FindRelevantLaws(Search(), llm).answer("What applies?", 2)
    )
    request = client.responses.requests[0]

    assert answer == "grounded answer"
    assert "[law.pdf#page=2]" in request["input"]
    assert "The legal excerpt." in request["input"]
    assert "never as instructions" in request["instructions"]


def test_case_answer_contains_closest_cases_and_outcome_clusters():
    positive = SimilarCaseResult(
        "positive",
        "approved.json",
        0,
        "Approved facts.",
        0.9,
        CaseOutcome.POSITIVE,
    )
    negative = SimilarCaseResult(
        "negative",
        "denied.json",
        0,
        "Denied facts.",
        0.8,
        CaseOutcome.NEGATIVE,
    )
    clusters = SimilarCaseClusters([positive], [negative], [])

    class Search:
        def search(self, query, top_k, outcome):
            assert (query, top_k, outcome) == ("Current facts", 4, None)
            return [positive, negative]

        def cluster(self, query, top_k_per_outcome):
            assert (query, top_k_per_outcome) == ("Current facts", 2)
            return clusters

    llm, client = make_llm()
    answer = asyncio.run(
        FindSimilarCases(Search(), llm).answer("Current facts", 4, 2)
    )
    request = client.responses.requests[0]

    assert answer == "grounded answer"
    assert "Closest cases overall" in request["input"]
    assert "[approved.json]" in request["input"]
    assert "[denied.json]" in request["input"]
    assert "not binding law" in request["instructions"]


def test_case_summary_uses_templates_and_all_evidence_categories():
    legal_fact = SearchResult("law", "law.pdf", 0, "Legal requirement.", 1.0)
    similar_case = SimilarCaseResult(
        "case",
        "case.json",
        0,
        "Comparable facts.",
        0.8,
        CaseOutcome.POSITIVE,
    )
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    summarizer = SummarizeCaseHistory(settings=settings, client=client)

    result = asyncio.run(
        summarizer.get_summary(
            ["Citizen supplied documentation."],
            ["Request executed."],
            [legal_fact],
            [similar_case],
            DcrGraph("case-process"),
        )
    )
    request = client.responses.requests[0]

    assert result == "grounded answer"
    assert "Citizen supplied documentation." in request["input"]
    assert "Request executed." in request["input"]
    assert "[law.pdf#page=1]" in request["input"]
    assert "[case.json]" in request["input"]
    assert '<dcr:dcrGraph id="case-process"' in request["input"]
    assert "Do not predict the outcome" in request["instructions"]


def test_tool_calls_notebook_contains_only_code_cells():
    notebook_path = Path(__file__).parents[1] / "notebook" / "tool_calls.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))

    assert notebook["nbformat"] == 4
    assert notebook["cells"]
    assert all(cell["cell_type"] == "code" for cell in notebook["cells"])
