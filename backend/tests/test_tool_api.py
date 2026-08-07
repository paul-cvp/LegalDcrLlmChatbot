import asyncio

import httpx

from app import create_app


def test_lists_available_tool_calls():
    async def request():
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.get("/api/tool-calls")

    response = asyncio.run(request())

    assert response.status_code == 200
    assert response.json() == [
        {"value": "find_relevant_laws", "label": "Find relevant laws"},
        {"value": "find_similar_cases", "label": "Find similar cases"},
        {
            "value": "summarize_case_history",
            "label": "Summarize case history",
        },
    ]
