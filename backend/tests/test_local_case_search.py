import json

import numpy as np

from tools.find_similar_cases import FindSimilarCases
from util.fileprocessor import FileProcessor
from util.jsonparser import JsonParser
from util.localcasesearch import (
    CaseOutcome,
    CaseOutcomeClassifier,
    LocalCaseSearch,
    SimilarCaseClusters,
)
from util.textparser import TextParser
from util.textsplitter import SimpleTextSplitter
from util.xmlparser import XmlParser


class FakeEmbeddingModel:
    identifier = "fake-case-model:v1"
    dimension = 2

    def encode_documents(self, texts):
        return np.asarray([self._vector(text) for text in texts], dtype=np.float32)

    def encode_query(self, text):
        return self._vector(text)

    @staticmethod
    def _vector(text):
        return np.asarray([1.0, 0.0] if "alpha" in text else [0.0, 1.0])


def processors():
    splitter = SimpleTextSplitter(max_object_length=30)
    return {
        ".pdf": FileProcessor(TextParser(), splitter),
        ".json": FileProcessor(JsonParser(), splitter),
        ".xml": FileProcessor(XmlParser(), splitter),
        ".txt": FileProcessor(TextParser(), splitter),
    }


def test_multi_format_case_index_search_and_outcome_clusters(tmp_path):
    cases = tmp_path / "cases"
    index = tmp_path / "case-index"
    cases.mkdir()
    (cases / "positive.json").write_text(
        json.dumps(
            {
                "decision_outcome": "positiv",
                "facts": "alpha facts repeated across multiple chunks",
            }
        )
    )
    (cases / "negative.xml").write_text(
        "<case><decision_outcome>negativ</decision_outcome>"
        "<facts>alpha rejected facts</facts></case>"
    )
    (cases / "pending.txt").write_text("status afventer alpha review")
    (cases / "approved.pdf").write_text("decision approved alpha application")

    search = LocalCaseSearch(
        cases_path=cases,
        index_path=index,
        embedding_model=FakeEmbeddingModel(),
        processors=processors(),
    )
    search.ensure_index()

    manifest = json.loads((index / "manifest.json").read_text())
    assert set(manifest["sources"]) == {
        "approved.pdf",
        "negative.xml",
        "pending.txt",
        "positive.json",
    }
    results = search.search("alpha", top_k=10)
    assert len(results) == 4
    assert len({result.source for result in results}) == 4

    clusters = search.cluster("alpha", top_k_per_outcome=10)
    assert {result.source for result in clusters.positive} == {
        "approved.pdf",
        "positive.json",
    }
    assert [result.source for result in clusters.negative] == ["negative.xml"]
    assert [result.source for result in clusters.unknown] == ["pending.txt"]
    assert search.search("alpha", outcome="negative") == clusters.negative


def test_partial_and_pending_outcomes_remain_unknown():
    assert CaseOutcomeClassifier.classify("delvis") is CaseOutcome.UNKNOWN
    assert CaseOutcomeClassifier.classify("afventer") is CaseOutcome.UNKNOWN


def test_find_similar_cases_delegates_to_local_case_search():
    expected = SimilarCaseClusters([], [], [])

    class FakeSearch:
        def search(self, query, top_k, outcome):
            assert (query, top_k, outcome) == ("facts", 2, "positive")
            return []

        def cluster(self, query, top_k_per_outcome):
            assert (query, top_k_per_outcome) == ("facts", 2)
            return expected

    tool = FindSimilarCases(FakeSearch())

    assert tool.find("facts", 2, "positive") == []
    assert tool.cluster("facts", 2) is expected
