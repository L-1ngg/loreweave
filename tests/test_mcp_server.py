from __future__ import annotations

import asyncio
import sys
import types
from dataclasses import dataclass

import pytest

from rag_system.infrastructure.config import (
    GenerationSettings,
    McpSettings,
    RetrievalProfileSettings,
    SecretValue,
    Settings,
)
from rag_system.domain.models import (
    AnswerCitation,
    AnswerResult,
    Evidence,
    GenerationMetadata,
    QueryContext,
    QueryPlan,
    SearchEvidenceResult,
)


def _install_fake_mcp() -> type:
    if "mcp.server.fastmcp" in sys.modules:
        return sys.modules["mcp.server.fastmcp"].FastMCP

    mcp = types.ModuleType("mcp")
    server = types.ModuleType("mcp.server")
    auth = types.ModuleType("mcp.server.auth")
    provider = types.ModuleType("mcp.server.auth.provider")
    settings = types.ModuleType("mcp.server.auth.settings")
    fastmcp = types.ModuleType("mcp.server.fastmcp")

    @dataclass
    class AccessToken:
        token: str
        client_id: str
        scopes: list[str]

    @dataclass
    class AuthSettings:
        issuer_url: str
        resource_server_url: str
        required_scopes: list[str]

    class FastMCP:
        def __init__(self, *args, **kwargs) -> None:
            self.args = args
            self.kwargs = kwargs
            self.tools: dict[str, object] = {}

        def tool(self, *tool_args, **tool_kwargs):
            def decorator(func):
                self.tools[func.__name__] = func
                return func

            return decorator

        def run(self, *args, **kwargs) -> None:  # pragma: no cover - not exercised here
            return None

    provider.AccessToken = AccessToken
    settings.AuthSettings = AuthSettings
    fastmcp.FastMCP = FastMCP

    sys.modules.update(
        {
            "mcp": mcp,
            "mcp.server": server,
            "mcp.server.auth": auth,
            "mcp.server.auth.provider": provider,
            "mcp.server.auth.settings": settings,
            "mcp.server.fastmcp": fastmcp,
        }
    )
    return FastMCP


FastMCP = _install_fake_mcp()

from rag_system.interfaces import mcp_server  # noqa: E402
from rag_system.interfaces.mcp_server import StaticTokenVerifier, create_mcp_server  # noqa: E402


class FakeRetrieval:
    def __init__(self) -> None:
        self.search_calls: list[tuple[str, str, int]] = []
        self.context_calls: list[tuple[str, int, int]] = []
        self.list_calls: list[tuple[str, int, str | None]] = []

    async def search_evidence(self, query: str, knowledge_base_id: str, top_k: int):
        self.search_calls.append((query, knowledge_base_id, top_k))
        return SearchEvidenceResult(
            status="ok",
            resolved_query=query,
            query_plan=QueryPlan(
                normalization_version="v1",
                raw_query=query,
                resolved_query=query,
                lexical_query=query,
                semantic_query=query,
            ),
            knowledge_base_id=knowledge_base_id,
            total_candidates=1,
            results=(
                Evidence(
                    rank=1,
                    chunk_id="chunk-1",
                    document_id="doc-1",
                    document_revision_id="rev-1",
                    title="Team Notes",
                    snippet="alpha",
                    page_start=1,
                    page_end=1,
                    section_path=("Intro",),
                    source_uri="rag://documents/doc-1/revisions/rev-1",
                    score=1.0,
                    term_score=1.0,
                    vector_score=1.0,
                ),
            ),
            next_context=QueryContext(user_query=query, resolved_query=query),
            truncated=False,
        )

    async def get_citation_context(self, chunk_id: str, before: int, after: int):
        self.context_calls.append((chunk_id, before, after))
        return [
            {
                "chunk_id": chunk_id,
                "document_id": "doc-1",
                "document_revision_id": "rev-1",
                "title": "Team Notes",
                "content": "alpha",
                "page_start": 1,
                "page_end": 1,
                "section_path": ["Intro"],
                "asset_refs": [],
                "source_uri": "rag://documents/doc-1/revisions/rev-1",
            }
        ]

    async def list_documents(
        self, knowledge_base_id: str, limit: int, cursor: str | None
    ):
        self.list_calls.append((knowledge_base_id, limit, cursor))
        return {"documents": [{"document_id": "doc-1"}], "next_cursor": "cursor-2"}


class FakeGeneration:
    def __init__(self, retrieval_result: SearchEvidenceResult) -> None:
        self.retrieval_result = retrieval_result
        self.answer_calls: list[tuple[str, str, int]] = []

    async def answer_question(self, query: str, knowledge_base_id: str, top_k: int):
        self.answer_calls.append((query, knowledge_base_id, top_k))
        evidence = self.retrieval_result.results[0]
        citation = AnswerCitation(
            marker=1,
            rank=evidence.rank,
            chunk_id=evidence.chunk_id,
            document_id=evidence.document_id,
            document_revision_id=evidence.document_revision_id,
            title=evidence.title,
            snippet=evidence.snippet,
            page_start=evidence.page_start,
            page_end=evidence.page_end,
            section_path=evidence.section_path,
            source_uri=evidence.source_uri,
            score=evidence.score,
            term_score=evidence.term_score,
            vector_score=evidence.vector_score,
            asset_refs=evidence.asset_refs,
        )
        return AnswerResult(
            status="answered",
            answer="alpha [1]",
            citations=(citation,),
            retrieval=self.retrieval_result,
            generation=GenerationMetadata(
                model="answer-model",
                prompt_version="v1",
            ),
        )


@pytest.mark.asyncio
async def test_static_token_verifier_accepts_only_the_expected_token() -> None:
    verifier = StaticTokenVerifier("secret-token")

    accepted = await verifier.verify_token("secret-token")
    rejected = await verifier.verify_token("wrong-token")

    assert accepted is not None
    assert accepted.token == "secret-token"
    assert accepted.client_id == "my-rag-client"
    assert accepted.scopes == ["rag:read"]
    assert rejected is None


@pytest.mark.asyncio
async def test_create_mcp_server_registers_tools_and_serializes_results() -> None:
    retrieval = FakeRetrieval()
    generation = FakeGeneration(
        await retrieval.search_evidence("answer alpha", "default", 7)
    )
    retrieval.search_calls.clear()
    settings = Settings(
        mcp=McpSettings(
            bearer_token=SecretValue("secret-token"),
            public_base_url="https://rag.example.com",
        ),
        retrieval=RetrievalProfileSettings(top_k=7),
    )

    server = create_mcp_server(settings, retrieval=retrieval, generation=generation)

    assert isinstance(server, FastMCP)
    assert set(server.tools) == {
        "search_evidence",
        "answer_question",
        "get_citation_context",
        "list_documents",
    }
    assert server.kwargs["token_verifier"] is not None
    assert server.kwargs["auth"].required_scopes == ["rag:read"]
    assert server.kwargs["auth"].issuer_url == "https://rag.example.com"

    search_result = await server.tools["search_evidence"]("find alpha")
    answer_result = await server.tools["answer_question"]("answer alpha")
    context_result = await server.tools["get_citation_context"]("chunk-1")
    documents_result = await server.tools["list_documents"]("kb-1", 5, None)

    assert retrieval.search_calls == [("find alpha", "default", 7)]
    assert generation.answer_calls == [("answer alpha", "default", 7)]
    assert search_result["status"] == "ok"
    assert search_result["results"][0]["chunk_id"] == "chunk-1"
    assert answer_result["status"] == "answered"
    assert answer_result["answer"] == "alpha [1]"
    assert answer_result["citations"][0]["chunk_id"] == "chunk-1"
    assert answer_result["generation"] == {
        "model": "answer-model",
        "prompt_version": "v1",
    }
    assert context_result["context"][0]["chunk_id"] == "chunk-1"
    assert documents_result == {
        "documents": [{"document_id": "doc-1"}],
        "next_cursor": "cursor-2",
    }


def test_create_mcp_server_omits_answer_tool_without_generation() -> None:
    server = create_mcp_server(Settings(), retrieval=FakeRetrieval())

    assert set(server.tools) == {
        "search_evidence",
        "get_citation_context",
        "list_documents",
    }


@pytest.mark.asyncio
async def test_serve_uses_retrieval_runtime_when_generation_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    class FakeRuntime:
        retrieval = object()

        async def close(self) -> None:
            events.append("close")

    class FakeServer:
        async def run_stdio_async(self) -> None:
            events.append("run")

    runtime = FakeRuntime()

    async def validate(candidate: object) -> None:
        assert candidate is runtime
        events.append("validate")

    def create_server(
        settings: Settings, *, retrieval: object, generation: object | None = None
    ) -> FakeServer:
        assert retrieval is runtime.retrieval
        assert generation is None
        return FakeServer()

    monkeypatch.setattr(mcp_server, "build_retrieval_runtime", lambda settings: runtime)
    monkeypatch.setattr(
        mcp_server,
        "build_generation_runtime",
        lambda settings: pytest.fail("generation runtime must not be built"),
    )
    monkeypatch.setattr(mcp_server, "validate_runtime_state", validate)
    monkeypatch.setattr(mcp_server, "create_mcp_server", create_server)

    await mcp_server._serve(Settings(), "stdio")

    assert events == ["validate", "run", "close"]


@pytest.mark.parametrize(
    ("transport", "run_event"),
    (("stdio", "run_stdio"), ("streamable-http", "run_streamable_http")),
)
@pytest.mark.asyncio
async def test_serve_uses_one_event_loop_for_runtime_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
    transport: str,
    run_event: str,
) -> None:
    events: list[tuple[str, asyncio.AbstractEventLoop]] = []

    class FakeRuntime:
        retrieval = object()
        generation = object()

        async def close(self) -> None:
            events.append(("close", asyncio.get_running_loop()))

    class FakeServer:
        async def run_stdio_async(self) -> None:
            events.append(("run_stdio", asyncio.get_running_loop()))

        async def run_streamable_http_async(self) -> None:
            events.append(("run_streamable_http", asyncio.get_running_loop()))

    runtime = FakeRuntime()

    async def validate(candidate: object) -> None:
        assert candidate is runtime
        events.append(("validate", asyncio.get_running_loop()))

    def create_server(
        settings: Settings, *, retrieval: object, generation: object
    ) -> FakeServer:
        assert retrieval is runtime.retrieval
        assert generation is runtime.generation
        return FakeServer()

    monkeypatch.setattr(
        mcp_server, "build_generation_runtime", lambda settings: runtime
    )
    monkeypatch.setattr(mcp_server, "validate_runtime_state", validate)
    monkeypatch.setattr(mcp_server, "create_mcp_server", create_server)

    running_loop = asyncio.get_running_loop()
    settings = Settings(
        generation=GenerationSettings(
            base_url="https://generation.example.com/v1",
            api_key=SecretValue("generation-key"),
            model="answer-model",
        )
    )
    await mcp_server._serve(settings, transport)

    assert [name for name, _ in events] == ["validate", run_event, "close"]
    assert all(loop is running_loop for _, loop in events)
