"""FastAPI application factory for the DCR Controller backend."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.chat_api import router as chat_router
from api.dcr_dashboard_api import router as dcr_dashboard_router
from api.documents_to_dcr_api import router as documents_to_dcr_router
from controller.dcr_dashboard_controller import DcrDashboardController
from object.domain import HealthResponse


def create_app() -> FastAPI:
    application = FastAPI(title="DCR Controller API", version="1.0.0")
    dashboard_controller = DcrDashboardController()
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

    @application.get("/api/health", tags=["System"], response_model=HealthResponse)
    async def health() -> HealthResponse:
        return dashboard_controller.health()

    return application
