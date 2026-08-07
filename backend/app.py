"""FastAPI application factory for the DCR Controller backend."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat_api import router as chat_router
from api.dcr_dashboard_api import router as dcr_dashboard_router
from api.documents_to_dcr_api import router as documents_to_dcr_router
from api.tool_api import router as tool_router
from tools.llm import get_llm
from util.localdocumentsearch import get_local_document_search
from util.localcasesearch import get_local_case_search
from util.localdcrgraphsearch import get_local_dcr_graph_search


STARTUP_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="backend-startup",
)


async def _run_startup_task(callback: Callable[[], None]) -> None:
    future = STARTUP_EXECUTOR.submit(callback)
    while not future.done():
        await asyncio.sleep(0.01)
    future.result()


@asynccontextmanager
async def lifespan(application: FastAPI):
    llm = get_llm()
    search = get_local_document_search()
    case_search = get_local_case_search()
    dcr_graph_search = get_local_dcr_graph_search()
    # Keep startup unavailable until the selected LLM and indexes are ready.
    # Blocking initialization runs outside FastAPI's event loop.
    await _run_startup_task(llm.ensure_available)
    await _run_startup_task(search.ensure_index)
    await _run_startup_task(case_search.ensure_index)
    await _run_startup_task(dcr_graph_search.ensure_index)
    application.state.llm = llm
    application.state.document_search = search
    application.state.case_search = case_search
    application.state.dcr_graph_search = dcr_graph_search
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="DCR Controller API", version="1.0.0", lifespan=lifespan
    )
    configured_origins = os.getenv(
        "DCR_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
    origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    application.include_router(dcr_dashboard_router)
    application.include_router(documents_to_dcr_router)
    application.include_router(chat_router)
    application.include_router(tool_router)

    return application
