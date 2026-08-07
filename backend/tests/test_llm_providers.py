import asyncio
import sys
from types import SimpleNamespace

import huggingface_hub
import pytest
from pydantic import BaseModel

import tools.llm as llm_module
from object.domain import ChatHistoryEntry, LLMChatRequest
from tools.llms.azure_llm import AzureLlm
from tools.llms.local_llm import LocalLlm, LocalLlmSettings


class StructuredValue(BaseModel):
    value: int


class FakeLocalModel:
    def __init__(self, **arguments):
        self.arguments = arguments
        self.requests = []

    def create_chat_completion(self, **arguments):
        self.requests.append(arguments)
        content = '{"value": 42}' if arguments["response_format"] else "answer"
        return {"choices": [{"message": {"content": content}}]}


@pytest.fixture(autouse=True)
def clear_llm_cache():
    llm_module.get_llm.cache_clear()
    yield
    llm_module.get_llm.cache_clear()


def test_local_llm_reuses_existing_model_and_handles_requests(
    tmp_path, monkeypatch
):
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"model")
    created_models = []

    def create_model(**arguments):
        model = FakeLocalModel(**arguments)
        created_models.append(model)
        return model

    monkeypatch.setitem(sys.modules, "llama_cpp", SimpleNamespace(Llama=create_model))
    monkeypatch.setattr(
        huggingface_hub,
        "hf_hub_download",
        lambda **_: pytest.fail("An existing model must not be downloaded."),
    )
    llm = LocalLlm(LocalLlmSettings("repo", model_path.name, tmp_path))

    llm.ensure_available()
    response = asyncio.run(
        llm.request(
            LLMChatRequest(text="next", instructions="system"),
            [ChatHistoryEntry(item="previous", chat_role="assistant")],
        )
    )
    structured = asyncio.run(
        llm.request_structured("number", "Return JSON", StructuredValue)
    )

    assert response.output_text == "answer"
    assert structured.value == 42
    assert len(created_models) == 1
    assert created_models[0].arguments == {
        "model_path": str(model_path),
        "n_ctx": 8192,
        "n_gpu_layers": -1,
        "n_threads": 16,
        "verbose": False,
    }
    assert created_models[0].requests[0]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "assistant", "content": "previous"},
        {"role": "user", "content": "next"},
    ]
    assert created_models[0].requests[1]["response_format"]["type"] == "json_object"


def test_local_llm_downloads_a_missing_model(tmp_path, monkeypatch):
    downloaded_path = tmp_path / "model.gguf"
    download_arguments = {}

    def download(**arguments):
        download_arguments.update(arguments)
        downloaded_path.write_bytes(b"model")
        return str(downloaded_path)

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", download)
    monkeypatch.setitem(
        sys.modules,
        "llama_cpp",
        SimpleNamespace(Llama=lambda **arguments: FakeLocalModel(**arguments)),
    )
    llm = LocalLlm(LocalLlmSettings("org/repo", "model.gguf", tmp_path))

    llm.ensure_available()

    assert download_arguments == {
        "repo_id": "org/repo",
        "filename": "model.gguf",
        "local_dir": tmp_path,
    }


def test_provider_defaults_to_local(monkeypatch):
    monkeypatch.setattr(llm_module, "load_dotenv", lambda _: None)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setenv("LOCAL_LLM_REPOSITORY", "org/repo")
    monkeypatch.setenv("LOCAL_LLM_FILENAME", "model.gguf")

    provider = llm_module.get_llm()

    assert isinstance(provider, LocalLlm)


def test_provider_can_select_azure(monkeypatch):
    monkeypatch.setattr(llm_module, "load_dotenv", lambda _: None)
    monkeypatch.setenv("LLM_PROVIDER", "azure")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.test")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "model")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret")

    provider = llm_module.get_llm()

    assert isinstance(provider, AzureLlm)


def test_provider_rejects_an_unknown_value(monkeypatch):
    monkeypatch.setattr(llm_module, "load_dotenv", lambda _: None)
    monkeypatch.setenv("LLM_PROVIDER", "unknown")

    with pytest.raises(RuntimeError, match="local.*azure"):
        llm_module.get_llm()
