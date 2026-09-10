from __future__ import annotations

import json

import httpx
import pytest

from rag_system.infrastructure.providers.reranker import HttpRerankerProvider


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url="https://rerank.example/v1/", transport=httpx.MockTransport(handler)
    )


def _provider(client: httpx.AsyncClient) -> HttpRerankerProvider:
    return HttpRerankerProvider(
        base_url="https://rerank.example/v1",
        api_key="secret",
        model="BAAI/bge-reranker-v2-m3",
        client=client,
    )


@pytest.mark.asyncio
async def test_reranker_parses_jina_style_response() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 1, "relevance_score": 2.5},
                    {"index": 0, "relevance_score": -1.0},
                ]
            },
        )

    client = _client(handler)
    provider = _provider(client)
    scores = await provider.rerank("query", ["doc-a", "doc-b"])

    assert scores == [-1.0, 2.5]
    assert requests[0]["model"] == "BAAI/bge-reranker-v2-m3"
    assert requests[0]["documents"] == ["doc-a", "doc-b"]
    assert requests[0]["top_n"] == 2
    assert "secret" not in repr(provider)
    await client.aclose()


@pytest.mark.asyncio
async def test_reranker_parses_tei_style_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"index": 0, "score": 0.75}])

    client = _client(handler)
    provider = _provider(client)
    assert await provider.rerank("query", ["doc-a"]) == [0.75]
    await client.aclose()


@pytest.mark.asyncio
async def test_reranker_rejects_incomplete_indexes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [{"index": 0, "score": 0.5}]})

    client = _client(handler)
    provider = _provider(client)
    with pytest.raises(ValueError, match="count does not match"):
        await provider.rerank("query", ["doc-a", "doc-b"])
    await client.aclose()


@pytest.mark.asyncio
async def test_reranker_rejects_out_of_range_duplicate_and_non_finite() -> None:
    payloads = (
        {"results": [{"index": 2, "score": 0.5}]},
        {"results": [{"index": 0, "score": 0.5}, {"index": 0, "score": 0.6}]},
        {"results": [{"index": 0, "score": "high"}]},
    )
    for payload in payloads:

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=payload)

        client = _client(handler)
        provider = _provider(client)
        with pytest.raises(ValueError):
            await provider.rerank("query", ["doc-a"])
        await client.aclose()


@pytest.mark.asyncio
async def test_reranker_empty_documents_short_circuits() -> None:
    provider = _provider(_client(lambda request: httpx.Response(500)))
    assert await provider.rerank("query", []) == []
