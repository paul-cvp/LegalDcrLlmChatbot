import asyncio
from pathlib import Path

import httpx
from lxml import etree

from app import create_app


EDITOR_XML = """<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="dcrGraph" />
</dcr:definitions>
"""

UPDATED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="updated" />
</dcr:definitions>
"""

LEXPLAIN_MODEL = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "models"
    / "Lexplain - Bekendtgørelse af barnets lov - merudgifter 86 stk 1.xml"
)


class APIClient:
    def __init__(self, application):
        self.application = application

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(app=self.application)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def get(self, path: str, **kwargs) -> httpx.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> httpx.Response:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs) -> httpx.Response:
        return self.request("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs) -> httpx.Response:
        return self.request("DELETE", path, **kwargs)


def make_client(tmp_path, monkeypatch) -> APIClient:
    monkeypatch.setenv("DCR_MODELS_DIR", str(tmp_path))
    return APIClient(create_app())


def test_crud_and_exact_xml_persistence(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)

    created = client.post(
        "/api/dcr-graphs", json={"name": "Example Graph", "xml": EDITOR_XML}
    )
    assert created.status_code == 201
    assert created.json() == {"name": "Example Graph", "xml": EDITOR_XML}
    assert (tmp_path / "Example Graph.xml").read_text(encoding="utf-8") == EDITOR_XML

    assert client.get("/api/dcr-graphs").json() == [created.json()]
    assert client.get("/api/dcr-graphs/Example%20Graph").json() == created.json()

    updated = client.put(
        "/api/dcr-graphs/Example%20Graph", json={"xml": UPDATED_XML}
    )
    assert updated.status_code == 200
    assert updated.json()["xml"] == UPDATED_XML
    assert (tmp_path / "Example Graph.xml").read_text(encoding="utf-8") == UPDATED_XML

    deleted = client.delete("/api/dcr-graphs/Example%20Graph")
    assert deleted.status_code == 204
    assert not (tmp_path / "Example Graph.xml").exists()
    assert client.get("/api/dcr-graphs/Example%20Graph").status_code == 404


def test_duplicate_names_are_case_insensitive_and_save_as_keeps_original(
    tmp_path, monkeypatch
):
    client = make_client(tmp_path, monkeypatch)
    assert client.post(
        "/api/dcr-graphs", json={"name": "Version One", "xml": EDITOR_XML}
    ).status_code == 201
    assert client.post(
        "/api/dcr-graphs", json={"name": "version one", "xml": EDITOR_XML}
    ).status_code == 409

    assert client.post(
        "/api/dcr-graphs", json={"name": "Version Two", "xml": UPDATED_XML}
    ).status_code == 201
    assert (tmp_path / "Version One.xml").read_text(encoding="utf-8") == EDITOR_XML
    assert (tmp_path / "Version Two.xml").read_text(encoding="utf-8") == UPDATED_XML


def test_update_can_rename_a_graph(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    assert client.post(
        "/api/dcr-graphs", json={"name": "Original Name", "xml": EDITOR_XML}
    ).status_code == 201

    renamed = client.put(
        "/api/dcr-graphs/Original%20Name",
        json={"name": "Renamed Graph", "xml": UPDATED_XML},
    )

    assert renamed.status_code == 200
    assert renamed.json() == {"name": "Renamed Graph", "xml": UPDATED_XML}
    assert not (tmp_path / "Original Name.xml").exists()
    assert (tmp_path / "Renamed Graph.xml").read_text(encoding="utf-8") == UPDATED_XML


def test_rename_rejects_an_existing_graph_name(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    for name in ("First Graph", "Second Graph"):
        assert client.post(
            "/api/dcr-graphs", json={"name": name, "xml": EDITOR_XML}
        ).status_code == 201

    response = client.put(
        "/api/dcr-graphs/First%20Graph",
        json={"name": "second graph", "xml": UPDATED_XML},
    )

    assert response.status_code == 409
    assert (tmp_path / "First Graph.xml").read_text(encoding="utf-8") == EDITOR_XML
    assert (tmp_path / "Second Graph.xml").read_text(encoding="utf-8") == EDITOR_XML


def test_unicode_graph_names_can_be_created_read_and_updated(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    name = "Bekendtgørelse af barnets lov"

    created = client.post(
        "/api/dcr-graphs", json={"name": name, "xml": EDITOR_XML}
    )
    assert created.status_code == 201
    assert created.json()["name"] == name
    assert client.get(f"/api/dcr-graphs/{name}").status_code == 200

    updated = client.put(
        f"/api/dcr-graphs/{name}", json={"xml": UPDATED_XML}
    )
    assert updated.status_code == 200
    assert (tmp_path / f"{name}.xml").read_text(encoding="utf-8") == UPDATED_XML


def test_missing_graphs_return_not_found(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    assert client.get("/api/dcr-graphs/Missing").status_code == 404
    assert client.put(
        "/api/dcr-graphs/Missing", json={"xml": EDITOR_XML}
    ).status_code == 404
    assert client.delete("/api/dcr-graphs/Missing").status_code == 404


def test_invalid_names_and_xml_are_rejected(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    invalid_names = [
        "../escape",
        "has.dot",
        "slash/name",
        "back\\slash",
        "_hidden",
        "   ",
        "name!",
    ]
    for name in invalid_names:
        response = client.post(
            "/api/dcr-graphs", json={"name": name, "xml": EDITOR_XML}
        )
        assert response.status_code == 422

    malformed = client.post(
        "/api/dcr-graphs", json={"name": "Malformed", "xml": "<broken>"}
    )
    assert malformed.status_code == 422

    wrong_root = client.post(
        "/api/dcr-graphs", json={"name": "Wrong Root", "xml": "<dcrgraph />"}
    )
    assert wrong_root.status_code == 422
    assert list(tmp_path.iterdir()) == []


def test_checked_in_lexplain_model_uses_editor_xml_and_expected_event_data():
    root = etree.parse(LEXPLAIN_MODEL).getroot()
    namespaces = {"dcr": "http://tk/schema/dcr"}

    assert root.tag == "{http://tk/schema/dcr}definitions"
    event_data = {
        element.get("name"): element.get("type")
        for element in root.xpath("//dcr:eventData", namespaces=namespaces)
    }
    assert event_data == {
        "isChildUnder18": "Bool",
        "age": "Int",
        "significantOrPermanentDisability": "Bool",
        "coveredByOtherLaws": "Bool",
        "disabilityConsequence": "String",
        "expenses": "String",
        "expenseAmount": "Int",
        "expenseDescription": "String",
    }
    assert not root.xpath("//*[local-name()='advanced']")
