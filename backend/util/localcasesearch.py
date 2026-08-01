"""Offline semantic search and outcome grouping for local case files."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path

from lxml import etree

from .fileprocessor import FileProcessor
from .jsonparser import JsonParser
from .localdocumentsearch import BACKEND_ROOT, LocalDocumentSearch, SearchResult
from .localembeddings import LocalEmbeddingModel
from .pdfparser import LocalPdfParser
from .textparser import TextParser
from .textsplitter import SentenceTextSplitter
from .xmlparser import XmlParser


DEFAULT_CASES_PATH = BACKEND_ROOT / "data" / "cases"
DEFAULT_CASE_INDEX_PATH = BACKEND_ROOT / "models" / "case_index"


class CaseOutcome(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class SimilarCaseResult(SearchResult):
    outcome: CaseOutcome


@dataclass(frozen=True)
class SimilarCaseClusters:
    positive: list[SimilarCaseResult]
    negative: list[SimilarCaseResult]
    unknown: list[SimilarCaseResult]


class CaseOutcomeClassifier:
    OUTCOME_KEYS = (
        "decisionoutcome",
        "outcome",
        "result",
        "status",
        "decision",
        "afgørelse",
        "afgorelse",
        "udfald",
    )
    POSITIVE_TERMS = {
        "positive",
        "positiv",
        "approved",
        "granted",
        "medhold",
        "bevilliget",
        "godkendt",
        "imødekommet",
        "imodekommet",
    }
    NEGATIVE_TERMS = {
        "negative",
        "negativ",
        "denied",
        "rejected",
        "afslag",
        "afslået",
        "afslaet",
    }

    @classmethod
    def from_file(cls, path: Path, fallback_text: str) -> CaseOutcome:
        suffix = path.suffix.lower()
        try:
            if suffix == ".json":
                value = cls._find_json_outcome(
                    json.loads(path.read_text(encoding="utf-8"))
                )
                if value is not None:
                    return cls.classify(value)
            elif suffix == ".xml":
                parser = etree.XMLParser(resolve_entities=False, no_network=True)
                root = etree.parse(path, parser).getroot()
                elements = {
                    cls._normalize_key(etree.QName(element).localname): element
                    for element in root.iter()
                }
                for key in cls.OUTCOME_KEYS:
                    element = elements.get(key)
                    if element is not None and element.text:
                        outcome = cls.classify(element.text)
                        if outcome is not CaseOutcome.UNKNOWN:
                            return outcome
        except (OSError, ValueError, etree.XMLSyntaxError):
            return CaseOutcome.UNKNOWN
        return cls.classify(fallback_text)

    @classmethod
    def classify(cls, value: str) -> CaseOutcome:
        normalized = value.casefold()
        if cls._contains_term(normalized, cls.NEGATIVE_TERMS):
            return CaseOutcome.NEGATIVE
        if cls._contains_term(normalized, cls.POSITIVE_TERMS):
            return CaseOutcome.POSITIVE
        return CaseOutcome.UNKNOWN

    @classmethod
    def _find_json_outcome(cls, value):
        if isinstance(value, dict):
            normalized = {cls._normalize_key(str(key)): nested for key, nested in value.items()}
            for key in cls.OUTCOME_KEYS:
                nested = normalized.get(key)
                if isinstance(nested, (str, bool)):
                    outcome = cls.classify(str(nested))
                    if outcome is not CaseOutcome.UNKNOWN:
                        return str(nested)
            for nested in value.values():
                found = cls._find_json_outcome(nested)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for nested in value:
                found = cls._find_json_outcome(nested)
                if found is not None:
                    return found
        return None

    @staticmethod
    def _normalize_key(value: str) -> str:
        return re.sub(r"[^a-zæøå]", "", value.casefold())

    @staticmethod
    def _contains_term(value: str, terms: set[str]) -> bool:
        return any(re.search(rf"\b{re.escape(term)}\b", value) for term in terms)


class LocalCaseSearch(LocalDocumentSearch):
    """Maintain a separate multi-format case index."""

    SCHEMA_VERSION = 2
    SUPPORTED_EXTENSIONS = {".pdf", ".json", ".xml", ".txt"}

    def __init__(
        self,
        cases_path: Path = DEFAULT_CASES_PATH,
        index_path: Path = DEFAULT_CASE_INDEX_PATH,
        embedding_model: LocalEmbeddingModel | None = None,
        processors: dict[str, FileProcessor] | None = None,
    ) -> None:
        splitter = SentenceTextSplitter()
        self.processors = processors or {
            ".pdf": FileProcessor(LocalPdfParser(), splitter),
            ".json": FileProcessor(JsonParser(), splitter),
            ".xml": FileProcessor(XmlParser(), splitter),
            ".txt": FileProcessor(TextParser(), splitter),
        }
        super().__init__(
            documents_path=cases_path,
            index_path=index_path,
            embedding_model=embedding_model,
            file_processor=self.processors[".pdf"],
        )

    def search(
        self,
        query: str,
        top_k: int = 5,
        outcome: CaseOutcome | str | None = None,
    ) -> list[SimilarCaseResult]:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        selected_outcome = CaseOutcome(outcome) if outcome is not None else None
        results = self._case_results(query)
        if selected_outcome is not None:
            results = [result for result in results if result.outcome is selected_outcome]
        return results[:top_k]

    def cluster(
        self, query: str, top_k_per_outcome: int = 5
    ) -> SimilarCaseClusters:
        if top_k_per_outcome < 1:
            raise ValueError("top_k_per_outcome must be at least 1.")
        grouped = {outcome: [] for outcome in CaseOutcome}
        for result in self._case_results(query):
            bucket = grouped[result.outcome]
            if len(bucket) < top_k_per_outcome:
                bucket.append(result)
        return SimilarCaseClusters(
            positive=grouped[CaseOutcome.POSITIVE],
            negative=grouped[CaseOutcome.NEGATIVE],
            unknown=grouped[CaseOutcome.UNKNOWN],
        )

    def _case_results(self, query: str) -> list[SimilarCaseResult]:
        results = []
        seen_sources = set()
        for record, score in self._rank_records(query):
            if record["source"] in seen_sources:
                continue
            seen_sources.add(record["source"])
            results.append(
                SimilarCaseResult(
                    chunk_id=record["chunk_id"],
                    source=record["source"],
                    page_number=record["page_number"],
                    text=record["text"],
                    score=score,
                    outcome=CaseOutcome(record.get("outcome", "unknown")),
                )
            )
        return results

    def _source_files(self) -> list[Path]:
        if not self.documents_path.is_dir():
            raise RuntimeError(
                f"Local case directory not found at {self.documents_path}."
            )
        return sorted(
            path
            for path in self.documents_path.rglob("*")
            if path.is_file() and path.suffix.lower() in self.SUPPORTED_EXTENSIONS
        )

    def _processor_for(self, path: Path) -> FileProcessor:
        return self.processors[path.suffix.lower()]

    def _source_metadata(self, path: Path, chunks: list) -> dict:
        text = "\n".join(chunk.text for chunk in chunks)
        outcome = CaseOutcomeClassifier.from_file(path, text)
        return {"outcome": outcome.value}


@lru_cache(maxsize=1)
def get_local_case_search() -> LocalCaseSearch:
    return LocalCaseSearch()
