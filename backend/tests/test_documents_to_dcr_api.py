import asyncio

import httpx

from api import documents_to_dcr_api
from app import create_app


def post(path: str, **kwargs) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(path, **kwargs)

    return asyncio.run(send())


def test_response_endpoint_keeps_model_credentials_on_backend(monkeypatch):
    class FakeResponse:
        output_text = "extracted result"

    received_inputs = []

    async def fake_create_response(input_text: str):
        received_inputs.append(input_text)
        return FakeResponse()

    monkeypatch.setattr(
        documents_to_dcr_api, "create_llm_response", fake_create_response
    )

    response = post(
        "/api/documents-to-dcr/responses",
        json={"input": "extract this process"},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "extracted result"}
    assert received_inputs == ["extract this process"]


def test_response_endpoint_rejects_empty_input():
    response = post("/api/documents-to-dcr/responses", json={"input": ""})
    assert response.status_code == 422
