from __future__ import annotations

from collections import deque
from dataclasses import replace

import pytest

from rag_system.processing.enrichment import EnrichmentService
from rag_system.domain.models import Chunk, EnrichmentStatus
from rag_system.processing.chunking import CHUNKING_VERSION
from rag_system.processing.enrichment import EnrichmentOptions


def _options() -> EnrichmentOptions:
    return EnrichmentOptions(
        enabled=True,
        keyword_top_n=2,
        question_top_n=1,
        prompt_version="v1",
        profile_id="chat-enrichment:test",
    )


def _chunk() -> Chunk:
    return Chunk(
        chunk_id="chunk-1",
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        title="Apollo Plan",
        content="Apollo migrates in July.",
        section_path=("Programs", "Apollo"),
        page_start=1,
        page_end=1,
        block_ids=("b1",),
        asset_refs=(),
        source_object_key="raw/source",
        embedding_profile_id="profile",
        chunking_version=CHUNKING_VERSION,
    )


class FakeChat:
    model_id = "model-a"

    def __init__(self, responses):
        self.responses = deque(responses)
        self.calls = []

    async def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        value = self.responses.popleft()
        if isinstance(value, Exception):
            raise value
        return value


class FakeCache:
    def __init__(self):
        self.values = {}
        self.puts = []

    async def get_enrichment_cache(self, key):
        return self.values.get(key)

    async def put_enrichment_cache(self, key, **kwargs):
        self.puts.append((key, kwargs))
        self.values[key] = kwargs["result"]


@pytest.mark.asyncio
async def test_enrichment_validates_caches_and_builds_seven_fields() -> None:
    chat = FakeChat(
        [
            {
                "keywords": ["Apollo", "July migration"],
                "questions": ["When does Apollo migrate?"],
            }
        ]
    )
    cache = FakeCache()
    service = EnrichmentService(_options(), chat_provider=chat, cache=cache)

    enriched, result = await service.enrich_chunk(_chunk(), language="en")
    cached, cached_result = await service.enrich_chunk(_chunk(), language="en")

    assert result.provenance.status is EnrichmentStatus.SUCCEEDED
    assert cached_result.provenance.status is EnrichmentStatus.CACHED
    assert len(chat.calls) == 1
    assert len(cache.puts) == 1
    assert enriched.important_kwd == ("Apollo", "July migration")
    assert enriched.question_kwd == ("When does Apollo migrate?",)
    assert enriched.important_tks
    assert enriched.question_tks
    assert enriched.title_tks and enriched.title_sm_tks
    assert enriched.content_ltks and enriched.content_sm_ltks
    assert "programs" in enriched.content_sm_ltks
    assert "apollo" in enriched.content_sm_ltks
    assert "[Programs > Apollo]" in chat.calls[0]["user_prompt"]
    assert cached.content_with_weight == _chunk().content
    assert not cached.content_with_weight.startswith("[Programs > Apollo]")


@pytest.mark.asyncio
async def test_enrichment_cache_identity_includes_header_path() -> None:
    response = {
        "keywords": ["Apollo", "July migration"],
        "questions": ["When does Apollo migrate?"],
    }
    chat = FakeChat([response, response])
    cache = FakeCache()
    service = EnrichmentService(_options(), chat_provider=chat, cache=cache)

    await service.enrich_chunk(_chunk(), language="en")
    await service.enrich_chunk(
        replace(_chunk(), section_path=("Programs", "Zeus")), language="en"
    )

    assert len(chat.calls) == 2
    assert len(cache.puts) == 2
    assert cache.puts[0][0] != cache.puts[1][0]


@pytest.mark.asyncio
async def test_manual_fields_take_priority_and_model_only_fills_missing_type() -> None:
    chat = FakeChat([{"keywords": [], "questions": ["When does Apollo migrate?"]}])
    service = EnrichmentService(_options(), chat_provider=chat, cache=FakeCache())

    enriched, _ = await service.enrich_chunk(
        _chunk(), language="en", manual_keywords=["manual one", "manual two"]
    )

    assert enriched.important_kwd == ("manual one", "manual two")
    assert enriched.question_kwd == ("When does Apollo migrate?",)
    assert "exactly 0" in chat.calls[0]["user_prompt"]


@pytest.mark.asyncio
async def test_partial_output_is_kept_but_never_cached() -> None:
    chat = FakeChat(
        [
            {"keywords": ["Apollo", "Migration"], "questions": []},
            {"keywords": ["Apollo", "Migration"], "questions": []},
        ]
    )
    cache = FakeCache()
    service = EnrichmentService(_options(), chat_provider=chat, cache=cache)

    enriched, result = await service.enrich_chunk(_chunk(), language="en")

    assert result.provenance.status is EnrichmentStatus.PARTIAL
    assert enriched.important_kwd == ("Apollo", "Migration")
    assert enriched.question_kwd == ()
    assert len(chat.calls) == 2
    assert cache.puts == []


@pytest.mark.asyncio
async def test_provider_failure_soft_degrades_after_two_attempts() -> None:
    chat = FakeChat([ConnectionError("secret"), ConnectionError("secret")])
    service = EnrichmentService(_options(), chat_provider=chat, cache=FakeCache())

    enriched, result = await service.enrich_chunk(_chunk(), language="en")

    assert result.provenance.status is EnrichmentStatus.FAILED
    assert result.provenance.error_summary
    assert enriched.important_kwd == ()
    assert enriched.question_kwd == ()
    assert len(chat.calls) == 2
