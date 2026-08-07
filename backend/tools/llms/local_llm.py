"""Local llama.cpp language-model provider."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from object.domain import ChatHistoryEntry, LLMChatRequest
from tools.llms import BaseLlm, LlmResponse, StructuredResponse


BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_DIR = BACKEND_ROOT / "models" / "local_llm"
LOCAL_LLM_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="local-llm",
)


@dataclass(frozen=True)
class LocalLlmSettings:
    repository: str
    filename: str
    model_dir: Path = DEFAULT_MODEL_DIR


class LocalLlm(BaseLlm):
    """Download and run one shared GGUF model through llama.cpp."""

    def __init__(self, settings: LocalLlmSettings) -> None:
        self.settings = settings
        self._model: Any | None = None
        self._lock = Lock()

    @property
    def model_path(self) -> Path:
        return self.settings.model_dir / self.settings.filename

    def ensure_available(self) -> None:
        """Download the configured model when needed and load it once."""
        with self._lock:
            if self._model is not None:
                return
            model_path = self._ensure_model_file()
            from llama_cpp import Llama

            self._model = Llama(
                model_path=str(model_path),
                n_ctx=8192,
                n_gpu_layers=-1,
                n_threads=16,
                verbose=False,
            )

    async def request(
        self,
        input_request: LLMChatRequest,
        history: list[ChatHistoryEntry] | None = None,
        default_instructions: str | None = None,
    ) -> LlmResponse:
        messages = self._messages(
            input_request.text,
            history,
            input_request.instructions or default_instructions,
        )
        text = await self._run_inference(messages)
        return LlmResponse(text)

    async def request_structured(
        self,
        input_text: str,
        instructions: str,
        response_model: type[StructuredResponse],
    ) -> StructuredResponse:
        messages = self._messages(input_text, None, instructions)
        response_format = {
            "type": "json_object",
            "schema": response_model.model_json_schema(),
        }
        text = await self._run_inference(messages, response_format)
        return response_model.model_validate_json(text)

    async def _run_inference(
        self,
        messages: list[dict[str, str]],
        response_format: dict[str, Any] | None = None,
    ) -> str:
        future = LOCAL_LLM_EXECUTOR.submit(
            self._complete,
            messages,
            response_format,
        )
        while not future.done():
            await asyncio.sleep(0.01)
        return future.result()

    def _ensure_model_file(self) -> Path:
        if self.model_path.is_file():
            return self.model_path

        self.settings.model_dir.mkdir(parents=True, exist_ok=True)
        from huggingface_hub import hf_hub_download

        downloaded = Path(
            hf_hub_download(
                repo_id=self.settings.repository,
                filename=self.settings.filename,
                local_dir=self.settings.model_dir,
            )
        )
        if not downloaded.is_file():
            raise RuntimeError(f"Local LLM download did not create {downloaded}.")
        return downloaded

    def _complete(
        self,
        messages: list[dict[str, str]],
        response_format: dict[str, Any] | None = None,
    ) -> str:
        self.ensure_available()
        with self._lock:
            response = self._model.create_chat_completion(
                messages=messages,
                temperature=0.2,
                max_tokens=512,
                response_format=response_format,
            )
        try:
            text = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError(
                "The local language model returned no text output."
            ) from error
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("The local language model returned no text output.")
        return text.strip()

    @staticmethod
    def _messages(
        input_text: str,
        history: list[ChatHistoryEntry] | None,
        instructions: str | None,
    ) -> list[dict[str, str]]:
        messages = []
        if instructions:
            messages.append({"role": "system", "content": instructions})
        messages.extend(
            {
                "role": "assistant" if entry.chat_role == "assistant" else "user",
                "content": entry.item,
            }
            for entry in history or []
        )
        messages.append({"role": "user", "content": input_text})
        return messages
