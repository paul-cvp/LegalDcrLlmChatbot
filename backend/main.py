"""ASGI entry point for the DCR Controller backend."""

import os

import uvicorn

from app import create_app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        reload=os.getenv("BACKEND_RELOAD", "true").lower() == "true",
    )
