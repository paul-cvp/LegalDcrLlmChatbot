import asyncio
import io
import json

import numpy as np
import pytest

from tools.find_relevant_dcr_graphs import FindRelevantDcrGraphs
from util.dcrgraphparser import DcrJsonTextParser, DcrXmlTextParser
from util.fileprocessor import FileProcessor
from util.localdcrgraphsearch import LocalDcrGraphSearch
from util.textsplitter import SimpleTextSplitter


class FakeEmbeddingModel:
    identifier = "fake-dcr-model:v1"
    dimension = 2

    def encode_documents(self, texts):
        return np.asarray([self._vector(text) for text in texts], dtype=np.float32)

    def encode_query(self, text):
        return self._vector(text)

    @staticmethod
    def _vector(text):
        return np.asarray([1.0, 0.0] if "expense" in text else [0.0, 1.0])


def processors(max_length=80):
    splitter = SimpleTextSplitter(max_object_length=max_length)
    return {
        ".xml": FileProcessor(DcrXmlTextParser(), splitter),
        ".json": FileProcessor(DcrJsonTextParser(), splitter),
    }


def make_search(graphs, index, max_length=80):
    return LocalDcrGraphSearch(
        graphs_path=graphs,
        index_path=index,
        embedding_model=FakeEmbeddingModel(),
        processors=processors(max_length),
    )


def test_xml_parser_extracts_semantics_and_excludes_layout():
    xml = b'''<dcr:definitions xmlns:dcr="http://tk/schema/dcr"
      xmlns:dcrDi="http://tk/schema/dcrDi"
      xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
      <dcr:dcrGraph id="expenses">
        <dcr:event id="request" label="Expense request"
          description="Apply for support" role="Citizen">
          <dcr:eventData name="amount" type="Int" default="10" />
        </dcr:event>
        <dcr:relation id="condition" type="condition" sourceRef="request"
          targetRef="request" guard="amount &gt; 0" forAll="true" />
      </dcr:dcrGraph>
      <dcrDi:dcrShape boardElement="request"><dc:Bounds x="999" y="888" /></dcrDi:dcrShape>
    </dcr:definitions>'''

    page = asyncio.run(_first_page(DcrXmlTextParser(), xml))

    assert "Expense request" in page.text
    assert "Apply for support" in page.text
    assert "role: Citizen" in page.text
    assert "name: amount" in page.text
    assert "parent: request" in page.text
    assert "type: condition" in page.text
    assert "guard: amount > 0" in page.text
    assert "999" not in page.text
    assert "dcrShape" not in page.text


def test_json_parser_flattens_arbitrary_valid_json():
    page = asyncio.run(
        _first_page(
            DcrJsonTextParser(),
            json.dumps(
                {"graph_id": "json-graph", "events": [{"label": "Review"}]}
            ).encode(),
        )
    )

    assert "graph_id: json-graph" in page.text
    assert "events.label: Review" in page.text


def test_graph_index_returns_full_content_and_deduplicates_chunks(tmp_path):
    graphs = tmp_path / "graphs"
    index = tmp_path / "index"
    graphs.mkdir()
    xml = '''<dcr:definitions xmlns:dcr="http://tk/schema/dcr"><dcr:dcrGraph id="xml-expense">
      <dcr:event id="event" label="expense support application with enough text for chunks" />
    </dcr:dcrGraph></dcr:definitions>'''
    json_graph = json.dumps(
        {"graph_id": "json-review", "events": [{"label": "case review"}]},
        indent=2,
    )
    (graphs / "expense.xml").write_text(xml)
    (graphs / "review.json").write_text(json_graph)
    (graphs / "ignored.txt").write_text("expense")
    search = make_search(graphs, index, max_length=30)

    results = search.search("expense", top_k=10)

    assert len(results) == 2
    assert len({result.source for result in results}) == 2
    by_source = {result.source: result for result in results}
    assert by_source["expense.xml"].graph_id == "xml-expense"
    assert by_source["expense.xml"].format == "xml"
    assert by_source["expense.xml"].content == xml
    assert by_source["review.json"].graph_id == "json-review"
    assert by_source["review.json"].content == json_graph
    manifest = json.loads((index / "manifest.json").read_text())
    assert set(manifest["sources"]) == {"expense.xml", "review.json"}


def test_search_synchronizes_create_update_rename_and_delete(tmp_path):
    graphs = tmp_path / "graphs"
    index = tmp_path / "index"
    graphs.mkdir()
    first = graphs / "first.json"
    first.write_text(json.dumps({"id": "first", "label": "review"}))
    search = make_search(graphs, index)
    assert [result.source for result in search.search("review")] == ["first.json"]

    first.write_text(json.dumps({"id": "updated", "label": "expense"}))
    assert search.search("expense")[0].graph_id == "updated"

    renamed = first.rename(graphs / "renamed.json")
    second = graphs / "second.xml"
    second.write_text(
        '<dcr:definitions xmlns:dcr="http://tk/schema/dcr">'
        '<dcr:dcrGraph id="second"><dcr:event id="e" label="expense" />'
        '</dcr:dcrGraph></dcr:definitions>'
    )
    assert {result.source for result in search.search("expense")} == {
        "renamed.json",
        "second.xml",
    }

    renamed.unlink()
    assert [result.source for result in search.search("expense")] == ["second.xml"]


@pytest.mark.parametrize(
    ("name", "content"),
    [("broken.json", "{"), ("broken.xml", "<dcrGraph>")],
)
def test_malformed_graph_fails_with_source_name(tmp_path, name, content):
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    (graphs / name).write_text(content)

    with pytest.raises(ValueError, match=name):
        make_search(graphs, tmp_path / "index").ensure_index()


def test_corrupt_graph_metadata_is_rebuilt(tmp_path):
    graphs = tmp_path / "graphs"
    index = tmp_path / "index"
    graphs.mkdir()
    (graphs / "graph.json").write_text('{"id": "expected", "label": "expense"}')
    search = make_search(graphs, index)
    search.ensure_index()
    manifest = json.loads((index / "manifest.json").read_text())
    index_file = index / manifest["sources"]["graph.json"]["index_file"]
    document = json.loads(index_file.read_text())
    document["metadata"].pop("graph_id")
    index_file.write_text(json.dumps(document))

    search.ensure_index()

    assert search.search("expense")[0].graph_id == "expected"


def test_find_relevant_dcr_graphs_delegates_to_local_search():
    class FakeSearch:
        def search(self, query, top_k):
            assert (query, top_k) == ("expense", 3)
            return ["result"]

    assert FindRelevantDcrGraphs(FakeSearch()).find("expense", 3) == ["result"]


async def _first_page(parser, content):
    return await anext(parser.parse(io.BytesIO(content)))
