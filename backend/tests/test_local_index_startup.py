import asyncio

from fastapi import FastAPI

import app as app_module


class FakeSearch:
    def __init__(self):
        self.initialized = False

    def ensure_index(self):
        self.initialized = True


def test_startup_prepares_all_local_indexes(monkeypatch):
    searches = [FakeSearch() for _ in range(3)]
    monkeypatch.setattr(app_module, "get_local_document_search", lambda: searches[0])
    monkeypatch.setattr(app_module, "get_local_case_search", lambda: searches[1])
    monkeypatch.setattr(app_module, "get_local_dcr_graph_search", lambda: searches[2])
    application = FastAPI()

    async def run_lifespan():
        async with app_module.lifespan(application):
            assert application.state.document_search is searches[0]
            assert application.state.case_search is searches[1]
            assert application.state.dcr_graph_search is searches[2]

    asyncio.run(run_lifespan())
    assert all(search.initialized for search in searches)
