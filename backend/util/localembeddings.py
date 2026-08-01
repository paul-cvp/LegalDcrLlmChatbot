"""Offline-only SentenceTransformer access shared by splitting and search."""

from __future__ import annotations

import hashlib
from functools import cached_property, lru_cache
from pathlib import Path

import numpy as np


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = BACKEND_ROOT / "models" / "local_gemma_embedding"


class LocalEmbeddingModel:
    """Load and run the local embedding model without network fallback."""

    def __init__(self, model_path: Path = DEFAULT_MODEL_PATH, batch_size: int = 16):
        self.model_path = Path(model_path)
        self.batch_size = batch_size

    @cached_property
    def model(self):
        self._require_model_path()
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(
            str(self.model_path),
            local_files_only=True,
        )

    @property
    def identifier(self) -> str:
        self._require_model_path()
        digest = hashlib.sha256()
        for name in ("config.json", "modules.json", "config_sentence_transformers.json"):
            path = self.model_path / name
            if path.is_file():
                digest.update(path.read_bytes())
        return f"{self.model_path.name}:{digest.hexdigest()}"

    def _require_model_path(self) -> None:
        if not self.model_path.is_dir():
            raise RuntimeError(
                f"Local embedding model not found at {self.model_path}. "
                "Install it manually before starting the backend."
            )

    @property
    def dimension(self) -> int:
        dimension_getter = getattr(self.model, "get_embedding_dimension", None)
        if dimension_getter is None:
            dimension_getter = self.model.get_sentence_embedding_dimension
        return int(dimension_getter())

    def count_tokens(self, text: str) -> int:
        return len(self.model.tokenizer.encode(text, add_special_tokens=True))

    def encode_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        return np.asarray(
            self.model.encode_document(
                texts,
                batch_size=self.batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ),
            dtype=np.float32,
        )

    def encode_query(self, text: str) -> np.ndarray:
        return np.asarray(
            self.model.encode_query(
                text,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ),
            dtype=np.float32,
        ).reshape(-1)


@lru_cache(maxsize=1)
def get_local_embedding_model() -> LocalEmbeddingModel:
    return LocalEmbeddingModel()
