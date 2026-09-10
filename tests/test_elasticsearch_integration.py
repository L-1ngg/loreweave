from __future__ import annotations

import os
from uuid import uuid4

from elasticsearch import AsyncElasticsearch
import pytest

from rag_system.infrastructure.elasticsearch_store import ElasticsearchRepository


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_revisions_removes_only_superseded_projection() -> None:
    elasticsearch_url = os.getenv("RAG_TEST_ELASTICSEARCH_URL")
    if not elasticsearch_url:
        pytest.skip("RAG_TEST_ELASTICSEARCH_URL is not configured")

    index = f"rag-test-{uuid4().hex}"
    client = AsyncElasticsearch(elasticsearch_url)
    repository = ElasticsearchRepository(client=client, chunks_alias=index)
    try:
        await client.indices.create(
            index=index,
            mappings={
                "properties": {
                    "document_revision_id": {"type": "keyword"},
                    "document_id": {"type": "keyword"},
                }
            },
        )
        await client.index(
            index=index,
            id="old-chunk",
            document={"document_revision_id": "rev-old", "document_id": "doc-1"},
        )
        await client.index(
            index=index,
            id="new-chunk",
            document={"document_revision_id": "rev-new", "document_id": "doc-1"},
            refresh="wait_for",
        )

        await repository.delete_revisions(["rev-old"], refresh=True)

        response = await client.search(
            index=index,
            query={"match_all": {}},
        )
        assert {hit["_id"] for hit in response["hits"]["hits"]} == {"new-chunk"}
    finally:
        if await client.indices.exists(index=index):
            await client.indices.delete(index=index)
        await client.close()
