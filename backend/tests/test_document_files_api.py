import asyncio
from pathlib import Path

import httpx

from api import documents_to_dcr_api
from app import create_app


def get(path: str, **kwargs) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path, **kwargs)

    return asyncio.run(send())


def configure_documents(monkeypatch, documents: Path) -> None:
    monkeypatch.setattr(documents_to_dcr_api.controller, "documents_path", documents)


def test_lists_nested_pdfs_in_display_order(monkeypatch, tmp_path):
    (tmp_path / "nested").mkdir()
    (tmp_path / "z-law.pdf").write_bytes(b"z")
    (tmp_path / "nested" / "A law.PDF").write_bytes(b"a")
    (tmp_path / "ignore.txt").write_text("ignore")
    configure_documents(monkeypatch, tmp_path)

    response = get("/api/documents-to-dcr/documents")

    assert response.status_code == 200
    assert response.json() == [
        {"filename": "nested/A law.PDF", "title": "A law"},
        {"filename": "z-law.pdf", "title": "z-law"},
    ]


def test_streams_pdf_with_encoded_nested_filename(monkeypatch, tmp_path):
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "A law.pdf").write_bytes(b"%PDF-test")
    configure_documents(monkeypatch, tmp_path)

    response = get("/api/documents-to-dcr/document", params={"filename": "nested/A law.pdf"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == b"%PDF-test"


def test_rejects_missing_non_pdf_and_traversal(monkeypatch, tmp_path):
    outside = tmp_path.parent / "outside.pdf"
    outside.write_bytes(b"outside")
    (tmp_path / "notes.txt").write_text("notes")
    configure_documents(monkeypatch, tmp_path)

    assert get("/api/documents-to-dcr/document", params={"filename": "missing.pdf"}).status_code == 404
    assert get("/api/documents-to-dcr/document", params={"filename": "notes.txt"}).status_code == 422
    assert get("/api/documents-to-dcr/document", params={"filename": "../outside.pdf"}).status_code == 422
