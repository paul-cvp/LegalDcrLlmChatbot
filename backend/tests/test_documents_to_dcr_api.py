import asyncio

import httpx

from api import documents_to_dcr_api
from app import create_app
from object.domain import ChatResponse


def process_xml(events: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<dcr:definitions xmlns:dcr="http://tk/schema/dcr">
  <dcr:dcrGraph id="dcrGraph" title="Test" description="Complete process">
    {events}
  </dcr:dcrGraph>
</dcr:definitions>'''


class FakeInterpretOutput:
    def __init__(self):
        self.activities = []

    async def get_activity_question(self, activity, graph):
        self.activities.append(
            (
                activity.ID,
                activity.label,
                activity.role,
                activity.description,
                graph.description,
            )
        )
        return f"Question for {activity.ID}?"


def post(path: str, **kwargs) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(path, **kwargs)

    return asyncio.run(send())


def test_response_endpoint_keeps_model_credentials_on_backend(monkeypatch):
    received_inputs = []

    async def fake_create_response(input_text: str, phase: str | None = None):
        received_inputs.append((input_text, phase))
        return ChatResponse(text="extracted result")

    monkeypatch.setattr(
        documents_to_dcr_api.controller, "create_response", fake_create_response
    )

    response = post(
        "/api/documents-to-dcr/responses",
        json={"input": "extract this process", "phase": "entities"},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "extracted result"}
    assert received_inputs == [("extract this process", "entities")]


def test_response_endpoint_rejects_empty_input():
    response = post("/api/documents-to-dcr/responses", json={"input": ""})
    assert response.status_code == 422


def test_activity_questions_rejects_unsupported_roles(monkeypatch):
    fake = FakeInterpretOutput()
    monkeypatch.setattr(documents_to_dcr_api.controller, "_interpret_output", fake)
    xml = process_xml(
        '<dcr:event id="Event_1" label="Review" description="Review" role="Clerk" />'
    )

    response = post(
        "/api/documents-to-dcr/activity-questions", json={"graph_xml": xml}
    )

    assert response.status_code == 422
    assert "unsupported role" in response.json()["detail"]
    assert fake.activities == []


def test_activity_questions_rejects_malformed_xml():
    response = post(
        "/api/documents-to-dcr/activity-questions",
        json={"graph_xml": "<not-closed>"},
    )

    assert response.status_code == 422
    assert "Invalid process XML" in response.json()["detail"]


def test_activity_questions_requires_citizen_event_data(monkeypatch):
    fake = FakeInterpretOutput()
    monkeypatch.setattr(documents_to_dcr_api.controller, "_interpret_output", fake)
    xml = process_xml(
        '<dcr:event id="Event_1" label="Apply" description="Apply" role="Citizen" />'
    )

    response = post(
        "/api/documents-to-dcr/activity-questions", json={"graph_xml": xml}
    )

    assert response.status_code == 422
    assert "must have event data" in response.json()["detail"]
    assert fake.activities == []


def test_activity_questions_processes_human_roles_sequentially(monkeypatch):
    fake = FakeInterpretOutput()
    monkeypatch.setattr(documents_to_dcr_api.controller, "_interpret_output", fake)
    xml = process_xml(
        '''<dcr:event id="Event_2" label="Review" description="Original review" role="Caseworker" />
        <dcr:event id="Event_1" label="Apply" description="Original application" role="Citizen" takesInput="true">
          <dcr:eventData name="application" type="String" />
        </dcr:event>
        <dcr:event id="Event_3" label="Notify" description="Original robot text" role="Robot" />'''
    )

    response = post(
        "/api/documents-to-dcr/activity-questions", json={"graph_xml": xml}
    )

    assert response.status_code == 200
    assert response.json() == {
        "questions": {
            "Event_1": "Question for Event_1?",
            "Event_2": "Question for Event_2?",
        }
    }
    assert fake.activities == [
        ("Event_1", "Apply", "Citizen", "Original application", "Complete process"),
        ("Event_2", "Review", "Caseworker", "Original review", "Complete process"),
    ]


def test_activity_question_uses_current_modal_values(monkeypatch):
    fake = FakeInterpretOutput()
    monkeypatch.setattr(documents_to_dcr_api.controller, "_interpret_output", fake)
    xml = process_xml(
        '<dcr:event id="Event_1" label="Old label" description="Old description" role="Citizen" />'
    )

    response = post(
        "/api/documents-to-dcr/activity-question",
        json={
            "graph_xml": xml,
            "event_id": "Event_1",
            "label": "Current label",
            "role": "Caseworker",
            "description": "Current description",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"text": "Question for Event_1?"}
    assert fake.activities == [
        (
            "Event_1",
            "Current label",
            "Caseworker",
            "Current description",
            "Complete process",
        )
    ]


def test_activity_question_rejects_unknown_event():
    xml = process_xml(
        '<dcr:event id="Event_1" label="Review" description="Review" role="Caseworker" />'
    )

    response = post(
        "/api/documents-to-dcr/activity-question",
        json={"graph_xml": xml, "event_id": "missing"},
    )

    assert response.status_code == 422
    assert "was not found" in response.json()["detail"]
