"""Offline semantic search for local XML and JSON DCR graphs."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from lxml import etree

from .dcrgraphparser import DcrJsonTextParser, DcrXmlTextParser
from .fileprocessor import FileProcessor
from .localdocumentsearch import BACKEND_ROOT, LocalDocumentSearch
from .localembeddings import LocalEmbeddingModel
from .textsplitter import SentenceTextSplitter


DEFAULT_DCR_GRAPHS_PATH = BACKEND_ROOT / "data" / "models"
DEFAULT_DCR_GRAPH_INDEX_PATH = BACKEND_ROOT / "models" / "dcr_graph_index"


@dataclass(frozen=True)
class RelevantDcrGraphResult:
    graph_id: str
    source: str
    format: Literal["xml", "json"]
    score: float
    excerpt: str
    content: str


class LocalDcrGraphSearch(LocalDocumentSearch):
    """Maintain a separate, automatically refreshed DCR graph index."""

    SCHEMA_VERSION = 2
    SUPPORTED_EXTENSIONS = {".xml", ".json"}

    def __init__(
        self,
        graphs_path: Path = DEFAULT_DCR_GRAPHS_PATH,
        index_path: Path = DEFAULT_DCR_GRAPH_INDEX_PATH,
        embedding_model: LocalEmbeddingModel | None = None,
        processors: dict[str, FileProcessor] | None = None,
    ) -> None:
        splitter = SentenceTextSplitter()
        self.processors = processors or {
            ".xml": FileProcessor(DcrXmlTextParser(), splitter),
            ".json": FileProcessor(DcrJsonTextParser(), splitter),
        }
        super().__init__(
            documents_path=graphs_path,
            index_path=index_path,
            embedding_model=embedding_model,
            file_processor=self.processors[".xml"],
        )

    def ensure_index(self, rebuild: bool = False) -> None:
        # Graph CRUD may change the small source directory while the app is running.
        self._ready = False
        super().ensure_index(rebuild=rebuild)

    def search(self, query: str, top_k: int = 5) -> list[RelevantDcrGraphResult]:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        results = []
        seen_sources = set()
        for record, score in self._rank_records(query):
            source = record["source"]
            if source in seen_sources:
                continue
            seen_sources.add(source)
            path = self.documents_path / source
            results.append(
                RelevantDcrGraphResult(
                    graph_id=record["graph_id"],
                    source=source,
                    format=record["format"],
                    score=score,
                    excerpt=record["text"],
                    content=path.read_text(encoding="utf-8"),
                )
            )
            if len(results) == top_k:
                break
        return results

    def _source_files(self) -> list[Path]:
        if not self.documents_path.is_dir():
            raise RuntimeError(
                f"Local DCR graph directory not found at {self.documents_path}."
            )
        return sorted(
            path
            for path in self.documents_path.rglob("*")
            if path.is_file() and path.suffix.lower() in self.SUPPORTED_EXTENSIONS
        )

    def _processor_for(self, path: Path) -> FileProcessor:
        return self.processors[path.suffix.lower()]

    def _source_metadata(self, path: Path, chunks: list) -> dict:
        try:
            graph_id = (
                self._xml_graph_id(path)
                if path.suffix.lower() == ".xml"
                else self._json_graph_id(path)
            )
        except (OSError, ValueError, etree.XMLSyntaxError, json.JSONDecodeError) as exc:
            raise ValueError(f"Invalid DCR graph {path.name!r}: {exc}") from exc
        return {"graph_id": graph_id or path.stem, "format": path.suffix[1:].lower()}

    def _index_source(self, path: Path, source: str, metadata: dict) -> None:
        try:
            super()._index_source(path, source, metadata)
        except (ValueError, etree.XMLSyntaxError, json.JSONDecodeError) as exc:
            raise ValueError(f"Unable to index DCR graph {source!r}: {exc}") from exc

    def _valid_document_file(
        self, path: Path, metadata: dict, dimension: int | None = None
    ) -> bool:
        if not super()._valid_document_file(path, metadata, dimension):
            return False
        document = self._read_json(path)
        graph_metadata = document.get("metadata")
        return (
            isinstance(graph_metadata, dict)
            and isinstance(graph_metadata.get("graph_id"), str)
            and graph_metadata.get("format") in {"xml", "json"}
            and all(
                chunk.get("graph_id") == graph_metadata["graph_id"]
                and chunk.get("format") == graph_metadata["format"]
                for chunk in document["chunks"]
            )
        )

    @staticmethod
    def _xml_graph_id(path: Path) -> str | None:
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        root = etree.parse(path, parser).getroot()
        for element in root.iter():
            if etree.QName(element).localname == "dcrGraph":
                return element.get("id")
        return root.get("id")

    @classmethod
    def _json_graph_id(cls, path: Path) -> str | None:
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls._find_json_id(data)

    @classmethod
    def _find_json_id(cls, value) -> str | None:
        if isinstance(value, dict):
            for key in ("graph_id", "graphId", "id", "name"):
                candidate = value.get(key)
                if isinstance(candidate, (str, int)):
                    return str(candidate)
            for key in ("dcrGraph", "graph"):
                nested = value.get(key)
                candidate = cls._find_json_id(nested)
                if candidate is not None:
                    return candidate
        return None


@lru_cache(maxsize=1)
def get_local_dcr_graph_search() -> LocalDcrGraphSearch:
    return LocalDcrGraphSearch()
