"""Persistent, fully local file embedding index and cosine search."""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from .fileprocessor import FileProcessor
from .localembeddings import LocalEmbeddingModel, get_local_embedding_model
from .pdfparser import LocalPdfParser
from .textsplitter import SentenceTextSplitter


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCUMENTS_PATH = BACKEND_ROOT / "data" / "documents"
DEFAULT_INDEX_PATH = BACKEND_ROOT / "models" / "document_index"


@dataclass(frozen=True)
class SearchResult:
    chunk_id: str
    source: str
    page_number: int
    text: str
    score: float


class LocalDocumentSearch:
    """Build and query a JSON-backed local document index."""

    SCHEMA_VERSION = 1
    MANIFEST_NAME = "manifest.json"

    def __init__(
        self,
        documents_path: Path = DEFAULT_DOCUMENTS_PATH,
        index_path: Path = DEFAULT_INDEX_PATH,
        embedding_model: LocalEmbeddingModel | None = None,
        file_processor: FileProcessor | None = None,
    ) -> None:
        self.documents_path = Path(documents_path)
        self.index_path = Path(index_path)
        self.embedding_model = embedding_model or get_local_embedding_model()
        self.file_processor = file_processor or FileProcessor(
            LocalPdfParser(), SentenceTextSplitter()
        )
        self._ready = False
        self._records: list[dict] | None = None
        self._matrix: np.ndarray | None = None

    def ensure_index(self, rebuild: bool = False) -> None:
        """Synchronize the local index with the PDF corpus."""
        if self._ready and not rebuild:
            return
        self.index_path.mkdir(parents=True, exist_ok=True)
        with self._build_lock():
            self._synchronize(rebuild)
        self._records = None
        self._matrix = None
        self._ready = True

    def rebuild(self) -> None:
        self.ensure_index(rebuild=True)

    def search(self, query: str, top_k: int = 5) -> list[SearchResult]:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        return [
            SearchResult(
                chunk_id=record["chunk_id"],
                source=record["source"],
                page_number=record["page_number"],
                text=record["text"],
                score=score,
            )
            for record, score in self._rank_records(query)[:top_k]
        ]

    def _rank_records(self, query: str) -> list[tuple[dict, float]]:
        if not query.strip():
            raise ValueError("Search query cannot be empty.")
        self.ensure_index()
        self._load_index()
        if self._matrix is None or not self._records:
            return []

        query_vector = self._normalize(self.embedding_model.encode_query(query))
        scores = self._matrix @ query_vector
        ranked = np.argsort(scores)[::-1]
        return [
            (self._records[index], float(scores[index]))
            for index in ranked
        ]

    def _synchronize(self, rebuild: bool) -> None:
        manifest = None if rebuild else self._read_json(self.index_path / self.MANIFEST_NAME)
        if not self._valid_manifest(manifest):
            manifest = None

        previous_sources = {} if manifest is None else manifest["sources"]
        current_files = self._source_files()
        current_sources = {
            self._relative_source(path): {
                "sha256": self._file_hash(path),
                "index_file": self._index_filename(self._relative_source(path)),
            }
            for path in current_files
        }

        if manifest is None:
            self._remove_index_json_files()

        for path in current_files:
            source = self._relative_source(path)
            metadata = current_sources[source]
            old = previous_sources.get(source)
            index_file = self.index_path / metadata["index_file"]
            dimension = manifest["embedding_dimension"] if manifest else None
            if old != metadata or not self._valid_document_file(
                index_file, metadata, dimension
            ):
                self._index_source(path, source, metadata)

        for source, metadata in previous_sources.items():
            if source not in current_sources:
                (self.index_path / metadata["index_file"]).unlink(missing_ok=True)

        referenced = {metadata["index_file"] for metadata in current_sources.values()}
        for path in self.index_path.glob("*.json"):
            if path.name not in referenced and path.name != self.MANIFEST_NAME:
                path.unlink()

        dimension = (
            manifest["embedding_dimension"]
            if manifest is not None and not rebuild
            else self.embedding_model.dimension
        )
        self._write_json(
            self.index_path / self.MANIFEST_NAME,
            {
                "schema_version": self.SCHEMA_VERSION,
                "model": self.embedding_model.identifier,
                "embedding_dimension": dimension,
                "sources": current_sources,
            },
        )

    def _index_source(self, path: Path, source: str, metadata: dict) -> None:
        with path.open("rb") as content:
            chunks = asyncio.run(self._processor_for(path).process(content))
        source_metadata = self._source_metadata(path, chunks)
        texts = [chunk.text for chunk in chunks]
        embeddings = self.embedding_model.encode_documents(texts)
        records = []
        for ordinal, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_id = hashlib.sha256(
                f"{source}:{chunk.page_num}:{ordinal}:{chunk.text}".encode("utf-8")
            ).hexdigest()
            records.append(
                {
                    "chunk_id": chunk_id,
                    "source": source,
                    "page_number": chunk.page_num,
                    "text": chunk.text,
                    "embedding": self._normalize(embedding).tolist(),
                    **source_metadata,
                }
            )
        self._write_json(
            self.index_path / metadata["index_file"],
            {
                "schema_version": self.SCHEMA_VERSION,
                "source": source,
                "sha256": metadata["sha256"],
                "metadata": source_metadata,
                "chunks": records,
            },
        )

    def _load_index(self) -> None:
        if self._records is not None:
            return
        manifest = self._read_json(self.index_path / self.MANIFEST_NAME)
        records = []
        for source in sorted(manifest["sources"]):
            metadata = manifest["sources"][source]
            document = self._read_json(self.index_path / metadata["index_file"])
            records.extend(document["chunks"])
        self._records = records
        if not records:
            self._matrix = np.empty(
                (0, manifest["embedding_dimension"]), dtype=np.float32
            )
            return
        matrix = np.asarray(
            [record["embedding"] for record in records], dtype=np.float32
        )
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        self._matrix = np.divide(
            matrix,
            norms,
            out=np.zeros_like(matrix),
            where=norms != 0,
        )

    def _valid_manifest(self, manifest) -> bool:
        if not isinstance(manifest, dict):
            return False
        if (
            manifest.get("schema_version") != self.SCHEMA_VERSION
            or manifest.get("model") != self.embedding_model.identifier
            or not isinstance(manifest.get("embedding_dimension"), int)
            or manifest["embedding_dimension"] < 1
            or not isinstance(manifest.get("sources"), dict)
        ):
            return False
        return all(
            isinstance(metadata, dict)
            and self._valid_document_file(
                self.index_path / metadata.get("index_file", ""),
                metadata,
                manifest["embedding_dimension"],
            )
            for metadata in manifest["sources"].values()
        )

    def _valid_document_file(
        self, path: Path, metadata: dict, dimension: int | None = None
    ) -> bool:
        document = self._read_json(path)
        if not isinstance(document, dict):
            return False
        valid_header = (
            document.get("schema_version") == self.SCHEMA_VERSION
            and document.get("sha256") == metadata.get("sha256")
            and isinstance(document.get("chunks"), list)
        )
        if not valid_header:
            return False
        return all(
            isinstance(chunk, dict)
            and isinstance(chunk.get("chunk_id"), str)
            and isinstance(chunk.get("source"), str)
            and isinstance(chunk.get("page_number"), int)
            and isinstance(chunk.get("text"), str)
            and isinstance(chunk.get("embedding"), list)
            and (dimension is None or len(chunk["embedding"]) == dimension)
            for chunk in document["chunks"]
        )

    def _source_files(self) -> list[Path]:
        if not self.documents_path.is_dir():
            raise RuntimeError(
                f"Local document directory not found at {self.documents_path}."
            )
        return sorted(
            path for path in self.documents_path.rglob("*")
            if path.is_file() and path.suffix.lower() == ".pdf"
        )

    def _processor_for(self, path: Path) -> FileProcessor:
        return self.file_processor

    def _source_metadata(self, path: Path, chunks: list) -> dict:
        return {}

    def _relative_source(self, path: Path) -> str:
        return path.relative_to(self.documents_path).as_posix()

    @staticmethod
    def _file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _index_filename(source: str) -> str:
        return f"{hashlib.sha256(source.encode('utf-8')).hexdigest()}.json"

    def _remove_index_json_files(self) -> None:
        for path in self.index_path.glob("*.json"):
            path.unlink()

    @staticmethod
    def _read_json(path: Path):
        try:
            with path.open(encoding="utf-8") as source:
                return json.load(source)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

    @staticmethod
    def _write_json(path: Path, value) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as destination:
                temporary = Path(destination.name)
                json.dump(value, destination, ensure_ascii=False)
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    @contextmanager
    def _build_lock(self):
        lock_path = self.index_path / ".build.lock"
        with lock_path.open("a+") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _normalize(vector) -> np.ndarray:
        value = np.asarray(vector, dtype=np.float32).reshape(-1)
        norm = np.linalg.norm(value)
        return value if norm == 0 else value / norm


@lru_cache(maxsize=1)
def get_local_document_search() -> LocalDocumentSearch:
    return LocalDocumentSearch()
