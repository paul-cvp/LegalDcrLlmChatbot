import asyncio
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from tools.find_relevant_laws import FindRelevantLaws
from util.fileprocessor import FileProcessor
from util.localdocumentsearch import LocalDocumentSearch, SearchResult
from util.localembeddings import LocalEmbeddingModel
from util.page import Chunk, Page
from util.textsplitter import SentenceTextSplitter


class FakeParser:
    async def parse(self, content):
        yield Page(page_num=0, offset=0, text="first page")
        yield Page(page_num=1, offset=10, text="second page")


class FakeSplitter:
    def split_pages(self, pages):
        return [Chunk(page_num=page.page_num, text=page.text) for page in pages]


class FakeProcessor:
    def __init__(self):
        self.calls = []

    async def process(self, content):
        text = content.read().decode("utf-8")
        self.calls.append(text)
        return [Chunk(page_num=0, text=text)]


class FakeEmbeddingModel:
    identifier = "fake-model:v1"
    dimension = 2

    def encode_documents(self, texts):
        return np.asarray([self._vector(text) for text in texts], dtype=np.float32)

    def encode_query(self, text):
        return self._vector(text)

    @staticmethod
    def _vector(text):
        return np.asarray([1.0, 0.0] if "alpha" in text else [0.0, 1.0])


def make_search(documents, index, processor=None):
    return LocalDocumentSearch(
        documents_path=documents,
        index_path=index,
        embedding_model=FakeEmbeddingModel(),
        file_processor=processor or FakeProcessor(),
    )


def test_file_processor_parses_and_splits_pages():
    processor = FileProcessor(FakeParser(), FakeSplitter())

    chunks = asyncio.run(processor.process(SimpleNamespace()))

    assert [(chunk.page_num, chunk.text) for chunk in chunks] == [
        (0, "first page"),
        (1, "second page"),
    ]


def test_sentence_splitter_uses_token_counter(monkeypatch):
    monkeypatch.setattr(
        "util.textsplitter._token_count", lambda text: len(text.split())
    )
    splitter = SentenceTextSplitter(max_tokens_per_section=4)

    chunks = list(
        splitter.split_page_by_max_tokens(
            0, "one two three four five six seven eight"
        )
    )

    assert len(chunks) > 1
    assert all(len(chunk.text.split()) <= 4 for chunk in chunks)


def test_json_index_build_search_update_and_delete(tmp_path):
    documents = tmp_path / "documents"
    index = tmp_path / "index"
    documents.mkdir()
    (documents / "alpha.pdf").write_text("alpha law")
    (documents / "beta.pdf").write_text("beta law")

    search = make_search(documents, index)
    search.ensure_index()

    manifest = json.loads((index / "manifest.json").read_text())
    assert set(manifest["sources"]) == {"alpha.pdf", "beta.pdf"}
    assert len(list(index.glob("*.json"))) == 3
    results = search.search("alpha", top_k=2)
    assert [result.source for result in results] == ["alpha.pdf", "beta.pdf"]
    assert results[0].score == pytest.approx(1.0)

    (documents / "alpha.pdf").write_text("beta replacement")
    (documents / "beta.pdf").unlink()
    updated = make_search(documents, index)
    updated.ensure_index()

    manifest = json.loads((index / "manifest.json").read_text())
    assert set(manifest["sources"]) == {"alpha.pdf"}
    assert updated.search("beta")[0].source == "alpha.pdf"


def test_corrupt_document_index_is_rebuilt(tmp_path):
    documents = tmp_path / "documents"
    index = tmp_path / "index"
    documents.mkdir()
    (documents / "law.pdf").write_text("alpha law")
    processor = FakeProcessor()
    search = make_search(documents, index, processor)
    search.ensure_index()
    document_index = next(path for path in index.glob("*.json") if path.name != "manifest.json")
    document_index.write_text("not json")

    repaired = make_search(documents, index, processor)
    repaired.ensure_index()

    assert json.loads(document_index.read_text())["chunks"]
    assert len(processor.calls) == 2


def test_concurrent_initialization_has_one_writer(tmp_path):
    documents = tmp_path / "documents"
    index = tmp_path / "index"
    documents.mkdir()
    (documents / "law.pdf").write_text("alpha law")
    processor = FakeProcessor()
    searches = [make_search(documents, index, processor) for _ in range(2)]

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda search: search.ensure_index(), searches))

    assert processor.calls == ["alpha law"]


def test_local_model_requires_folder_and_disables_network(tmp_path, monkeypatch):
    missing = LocalEmbeddingModel(tmp_path / "missing")
    with pytest.raises(RuntimeError, match="Local embedding model not found"):
        _ = missing.model

    model_path = tmp_path / "model"
    model_path.mkdir()
    received = []

    class FakeSentenceTransformer:
        def __init__(self, path, **kwargs):
            received.append((path, kwargs))

    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        SimpleNamespace(SentenceTransformer=FakeSentenceTransformer),
    )
    local = LocalEmbeddingModel(model_path)

    _ = local.model

    assert received == [(str(model_path), {"local_files_only": True})]


def test_find_relevant_laws_delegates_to_local_search():
    expected = [SearchResult("id", "law.pdf", 2, "law text", 0.9)]

    class FakeSearch:
        def search(self, query, top_k):
            assert (query, top_k) == ("question", 3)
            return expected

    assert FindRelevantLaws(FakeSearch()).find("question", 3) == expected
