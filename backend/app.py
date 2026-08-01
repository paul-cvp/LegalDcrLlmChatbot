"""FastAPI application factory for the DCR Controller backend."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat_api import router as chat_router
from api.dcr_dashboard_api import router as dcr_dashboard_router
from api.documents_to_dcr_api import router as documents_to_dcr_router
from util.localdocumentsearch import get_local_document_search
from util.localcasesearch import get_local_case_search
from util.localdcrgraphsearch import get_local_dcr_graph_search


@asynccontextmanager
async def lifespan(application: FastAPI):
    search = get_local_document_search()
    case_search = get_local_case_search()
    dcr_graph_search = get_local_dcr_graph_search()
    # Startup remains unavailable until the local index is ready.
    # Parsers run their own async loop, so build outside FastAPI's event loop.
    await asyncio.to_thread(search.ensure_index)
    await asyncio.to_thread(case_search.ensure_index)
    await asyncio.to_thread(dcr_graph_search.ensure_index)
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

    return application
