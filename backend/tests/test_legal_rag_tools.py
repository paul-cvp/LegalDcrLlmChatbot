import asyncio
import json
from pathlib import Path

from object.domain import ChatHistoryEntry, LLMSettings
from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrExecution, DcrGraph
from pm4py.objects.dcr.ocdcr.semantics import DcrSemantics
from tools.find_relevant_laws import FindRelevantLaws
from tools.find_similar_cases import FindSimilarCases
from tools.llm import LlmTool
from tools.summarize_case import SummarizeCaseHistory
from tools.tool_call import ToolCall
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
        FindRelevantLaws(Search(), llm).answer(
            "What applies?",
            {"Process title": "Housing support", "Process description": None},
            user_info="The citizen rents their home.",
            graph_execution_trace=[{"label": "Application", "data": "pending"}],
            use_data=True,
            chat_history=[ChatHistoryEntry(item="The lease was uploaded.", chat_role="user")],
            top_k=2,
        )
    )
    request = client.responses.requests[0]

    assert answer == "grounded answer"
    assert "[law.pdf#page=2]" in request["input"]
    assert "The legal excerpt." in request["input"]
    assert "The citizen rents their home." in request["input"]
    assert "Housing support" in request["input"]
    assert "'data': 'pending'" in request["input"]
    assert "The lease was uploaded." in request["input"]
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
        FindSimilarCases(Search(), llm).answer(
            "Current facts",
            {"Process title": "Care benefit"},
            user_info="The citizen has one dependent.",
            graph_execution_trace=[{"label": "Application", "data": "complete"}],
            use_data=True,
            chat_history=[ChatHistoryEntry(item="One dependent", chat_role="user")],
            top_k=4,
            top_k_per_outcome=2,
        )
    )
    request = client.responses.requests[0]

    assert answer == "grounded answer"
    assert "Closest cases overall" in request["input"]
    assert "[approved.json]" in request["input"]
    assert "[denied.json]" in request["input"]
    assert "The citizen has one dependent." in request["input"]
    assert "Care benefit" in request["input"]
    assert "'data': 'complete'" in request["input"]
    assert "One dependent" in request["input"]
    assert "not binding law" in request["instructions"]


def test_law_and_case_prompts_adapt_to_unavailable_context_and_results():
    class EmptyLawSearch:
        def search(self, query, top_k):
            return []

    class EmptyCaseSearch:
        def search(self, query, top_k, outcome):
            return []

        def cluster(self, query, top_k_per_outcome):
            return SimilarCaseClusters([], [], [])

    law_llm, law_client = make_llm()
    case_llm, case_client = make_llm()
    asyncio.run(
        FindRelevantLaws(EmptyLawSearch(), law_llm).answer(
            "Question", {}, user_info=" ", use_data=False, chat_history=[]
        )
    )
    asyncio.run(
        FindSimilarCases(EmptyCaseSearch(), case_llm).answer(
            "Facts", {}, user_info=None, use_data=False, chat_history=[]
        )
    )

    law_request = law_client.responses.requests[0]
    case_request = case_client.responses.requests[0]
    assert "Process information:" not in law_request["input"]
    assert "Citizen information:" not in law_request["input"]
    assert "DCR trace data:" not in law_request["input"]
    assert "No legal source excerpts were retrieved" in law_request["instructions"]
    assert "Closest cases overall:" not in case_request["input"]
    assert "outcome cluster:" not in case_request["input"]
    assert "No similar cases were retrieved" in case_request["input"]
    assert "DCR trace data is unavailable" in case_request["instructions"]


def test_non_summary_tool_context_excludes_graph_and_activity_ids():
    received = {}

    def tool(query, process_info, **kwargs):
        received.update(query=query, process_info=process_info, **kwargs)
        return "result"

    previous = DcrActivity("previous", label="Previous activity")
    previous.data = "case data"
    current = DcrActivity("current", description="Find evidence")
    current.tool_call = tool
    graph = DcrGraph("case", elements={previous, current})
    graph.title = "Case process"
    graph.executions.append(DcrExecution(previous.ID))
    semantics = DcrSemantics(
        user_context="Citizen context",
        use_trace_data=True,
        chat_history=[ChatHistoryEntry(item="Prior answer", chat_role="user")],
    )

    assert semantics.invoke_tool(current, graph) == "result"
    assert received["query"] == "Find evidence"
    assert received["process_info"]["Process title"] == "Case process"
    assert "graph" not in received
    assert all("id" not in item for item in received["graph_execution_trace"])


def test_case_summary_uses_only_available_evidence_categories():
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    summarizer = SummarizeCaseHistory(settings=settings, client=client)
    law = DcrActivity("law", label="Relevant laws")
    law.tool_call = ToolCall.FIND_RELEVANT_LAWS
    similar = DcrActivity("similar", label="Similar cases")
    similar.tool_call = ToolCall.FIND_SIMILAR_CASES
    fact = DcrActivity("fact", label="Application facts")
    graph = DcrGraph("case-process", elements={law, similar, fact})

    result = asyncio.run(
        summarizer.get_summary(
            "Summarize the case",
            {"title": "Care benefit", "description": None},
            graph=graph,
            user_info="Citizen supplied documentation.",
            graph_execution_trace=[
                {"id": "law", "label": "Relevant laws", "data": "Rule [law.pdf#page=2]"},
                {"id": "similar", "label": "Similar cases", "data": []},
                {"id": "fact", "label": "Application facts", "data": "Request executed."},
            ],
            use_data=True,
            chat_history=[
                ChatHistoryEntry(item="The application was received.", chat_role="user")
            ],
        )
    )
    request = client.responses.requests[0]

    assert result == "grounded answer"
    assert "Citizen supplied documentation." in request["input"]
    assert "Request executed." in request["input"]
    assert "Relevant-law tool output" in request["input"]
    assert "Rule [law.pdf#page=2]" in request["input"]
    assert "Similar-case tool output" not in request["input"]
    assert "The application was received." in request["input"]
    assert '<dcr:dcrGraph id="case-process"' in request["input"]
    assert "Relevant-law tool output is available" in request["instructions"]
    assert "No similar-case tool output is available" in request["instructions"]
    assert "Do not predict the outcome" in request["instructions"]


def test_case_summary_omits_disabled_or_empty_inputs():
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    summarizer = SummarizeCaseHistory(settings=settings, client=client)
    law = DcrActivity("law", label="Relevant laws")
    law.tool_call = ToolCall.FIND_RELEVANT_LAWS
    graph = DcrGraph("case-process", elements={law})

    asyncio.run(
        summarizer.get_summary(
            " ",
            {"title": None, "description": ""},
            graph=graph,
            user_info=" ",
            graph_execution_trace=[
                {"id": "law", "label": "Relevant laws", "data": "Must not be used"},
            ],
            use_data=False,
            chat_history=[],
        )
    )
    request = client.responses.requests[0]

    assert "Must not be used" not in request["input"]
    assert "Summary request:" not in request["input"]
    assert "Process information:" not in request["input"]
    assert "User information:" not in request["input"]
    assert "Chat history:" not in request["input"]
    assert "Case activity data is unavailable because its use was disabled" in request["instructions"]
    assert "No relevant-law tool output is available" in request["instructions"]
    assert "No similar-case tool output is available" in request["instructions"]
    assert "No user information is available" in request["instructions"]


def test_case_summary_does_not_invent_missing_laws_or_similar_cases():
    client = FakeClient()
    settings = LLMSettings("https://example.test", "model", "secret")
    summarizer = SummarizeCaseHistory(settings=settings, client=client)
    fact = DcrActivity("fact", label="Application received")
    graph = DcrGraph("case-process", elements={fact})

    asyncio.run(
        summarizer.get_summary(
            "Summarize",
            graph=graph,
            graph_execution_trace=[
                {"id": "fact", "label": "Application received", "data": True},
            ],
            use_data=True,
        )
    )
    request = client.responses.requests[0]

    assert "Other current case activity data" in request["input"]
    assert "Relevant-law tool output:" not in request["input"]
    assert "Similar-case tool output:" not in request["input"]
    assert "No relevant-law tool output is available" in request["instructions"]
    assert "No similar-case tool output is available" in request["instructions"]


def test_tool_calls_notebook_contains_only_code_cells():
    notebook_path = Path(__file__).parents[1] / "notebook" / "tool_calls.ipynb"
    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))

    assert notebook["nbformat"] == 4
    assert notebook["cells"]
    assert all(cell["cell_type"] == "code" for cell in notebook["cells"])
