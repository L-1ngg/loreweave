from __future__ import annotations

import json

import httpx
import pytest

from rag_system.infrastructure.config import (
    EmbeddingSettings,
    SecretValue,
    Settings,
)
from rag_system.domain.models import Chunk
from rag_system.infrastructure.providers.embeddings import (
    OpenAICompatibleEmbeddingProvider,
)
from rag_system.processing.chunking import CHUNKING_VERSION
from rag_system.processing.embedding import embed_enriched_chunks


async def test_embed_batches_requests_and_restores_response_order() -> None:
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        calls.append(payload)
        assert request.url.path == "/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer secret"
        assert payload["model"] == "text-embedding-3-large"
        assert "dimensions" not in payload

        embedding_by_text = {
            "alpha": [1.0, 1.1, 1.2],
            "beta": [2.0, 2.1, 2.2],
            "gamma": [3.0, 3.1, 3.2],
        }
        data = [
            {"index": index, "embedding": embedding_by_text[text]}
            for index, text in enumerate(payload["input"])
        ]
        data.reverse()
        return httpx.Response(200, json={"model": payload["model"], "data": data})

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://embeddings.example/v1/",
    )
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="https://embeddings.example/v1",
        api_key="secret",
        model="text-embedding-3-large",
        dimensions=3,
        batch_size=2,
        client=client,
    )

    embeddings = await provider.embed(["alpha", "beta", "gamma"])

    assert provider.profile_id == "openai-compatible:text-embedding-3-large:3:cosine:v1"
    assert calls == [
        {
            "model": "text-embedding-3-large",
            "input": ["alpha", "beta"],
        },
        {
            "model": "text-embedding-3-large",
            "input": ["gamma"],
        },
    ]
    assert embeddings == [
        [1.0, 1.1, 1.2],
        [2.0, 2.1, 2.2],
        [3.0, 3.1, 3.2],
    ]

    await client.aclose()


async def test_embed_can_send_dimensions_when_enabled() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        seen.append(payload)
        return httpx.Response(
            200,
            json={
                "model": payload["model"],
                "data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}],
            },
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://embeddings.example/v1/",
    )
    provider = OpenAICompatibleEmbeddingProvider.from_settings(
        Settings(
            embedding=EmbeddingSettings(
                base_url="https://embeddings.example/v1",
                api_key=SecretValue("secret"),
                model="text-embedding-3-large",
                dimensions=3,
                send_dimensions=True,
                batch_size=1,
            ),
        ),
        client=client,
    )

    embeddings = await provider.embed(["alpha"])

    assert "secret" not in repr(provider)
    assert seen == [
        {
            "model": "text-embedding-3-large",
            "input": ["alpha"],
            "dimensions": 3,
        }
    ]
    assert embeddings == [[0.1, 0.2, 0.3]]

    await client.aclose()


async def test_embed_rejects_invalid_payloads() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "model": "text-embedding-3-large",
                "data": [{"index": 0, "embedding": [0.1, 0.2]}],
            },
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://embeddings.example/v1/",
    )
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="https://embeddings.example/v1",
        api_key="secret",
        model="text-embedding-3-large",
        dimensions=3,
        batch_size=1,
        client=client,
    )

    try:
        await provider.embed(["alpha"])
    except ValueError as exc:
        assert "dimensions" in str(exc)
    else:
        raise AssertionError("expected invalid embedding payload to raise ValueError")

    await client.aclose()


def test_parse_response_rejects_boolean_indexes_and_non_finite_values() -> None:
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="https://embeddings.example/v1",
        api_key="secret",
        model="model",
        dimensions=1,
    )

    with pytest.raises(ValueError, match="integer index"):
        provider._parse_response(
            {"data": [{"index": True, "embedding": [0.1]}]}, expected_count=1
        )
    with pytest.raises(ValueError, match="finite numbers"):
        provider._parse_response(
            {"data": [{"index": 0, "embedding": [float("nan")]}]},
            expected_count=1,
        )


class MixedEmbeddingProvider:
    dimensions = 2

    def __init__(self) -> None:
        self.calls = []

    async def embed(self, texts):
        self.calls.append(list(texts))
        if texts == ["Document title"]:
            return [[1.0, 0.0]]
        return [[0.0, 1.0] if "question" in text else [1.0, 0.0] for text in texts]


def _mixed_chunk(*, questions=()) -> Chunk:
    return Chunk(
        chunk_id="chunk-1",
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        title="Document title",
        content="body fallback",
        section_path=("Programs", "Apollo"),
        page_start=1,
        page_end=1,
        block_ids=("b1",),
        asset_refs=(),
        source_object_key="raw/source",
        embedding_profile_id="profile",
        chunking_version=CHUNKING_VERSION,
        question_kwd=questions,
    )


@pytest.mark.asyncio
async def test_questions_drive_semantic_embedding_and_title_is_mixed_at_point_one() -> (
    None
):
    provider = MixedEmbeddingProvider()
    result = await embed_enriched_chunks(
        provider, [_mixed_chunk(questions=("question one", "question two"))]
    )

    assert provider.calls == [
        ["Document title"],
        ["[Programs > Apollo]\n\nquestion one\nquestion two"],
    ]
    norm = (0.1**2 + 0.9**2) ** 0.5
    assert result[0].content_vector == pytest.approx((0.1 / norm, 0.9 / norm))


@pytest.mark.asyncio
async def test_content_is_embedding_fallback_when_questions_are_empty() -> None:
    provider = MixedEmbeddingProvider()
    await embed_enriched_chunks(provider, [_mixed_chunk()])
    assert provider.calls[1] == ["[Programs > Apollo]\n\nbody fallback"]
