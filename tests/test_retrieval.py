from __future__ import annotations

from datetime import UTC, datetime
import math

import pytest

from rag_system.domain.fusion import rrf_fuse
from rag_system.domain.models import Chunk, RankedChunk
from rag_system.application.retrieval import (
    RetrievalError,
    RetrievalService,
    field_aware_term_score,
    search_result_to_dict,
)
from rag_system.processing.chunking import CHUNKING_VERSION


def _chunk(chunk_id: str, *, content: str, ordinal: int) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        title="Apollo migration",
        content=content,
        content_with_weight=content,
        section_path=("Migration",),
        page_start=1,
        page_end=1,
        block_ids=("b1",),
        asset_refs=(),
        source_object_key="raw/source",
        embedding_profile_id="profile",
        chunking_version=CHUNKING_VERSION,
        important_kwd=("Apollo", "July migration"),
        important_tks="apollo july migration",
        question_kwd=("When did Apollo migrate?",),
        question_tks="when did apollo migrate",
        title_tks="apollo migration",
        title_sm_tks="apollo migration",
        content_ltks="apollo migrated july",
        content_sm_ltks="apollo migrated in july",
        metadata={"chunk_ordinal": ordinal},
        created_at=datetime(2026, 7, 23, tzinfo=UTC),
    )


class FakeEmbedding:
    dimensions = 3
    profile_id = "profile"

    def __init__(self, fail: bool = False) -> None:
        self.calls = []
        self.fail = fail

    async def embed(self, texts):
        self.calls.append(list(texts))
        if self.fail:
            raise ConnectionError("secret provider message")
        return [[0.1, 0.2, 0.3] for _ in texts]


class FakeRepository:
    def __init__(self) -> None:
        self.lexical_calls = []
        self.knn_calls = []
        self.vector_calls = []
        self.current = _chunk("chunk-1", content="Apollo migrated in July.", ordinal=1)

    async def lexical_search(self, query, knowledge_base_id, filters, limit):
        self.lexical_calls.append((query, knowledge_base_id, filters, limit))
        return [RankedChunk(self.current, 1, 12.0)]

    async def knn_search(self, vector, knowledge_base_id, filters, limit):
        self.knn_calls.append((vector, knowledge_base_id, filters, limit))
        return [RankedChunk(self.current, 1, 0.9)]

    async def vector_scores(self, vector, knowledge_base_id, candidate_ids, filters):
        self.vector_calls.append((vector, knowledge_base_id, candidate_ids, filters))
        return {"chunk-1": 0.9}

    async def get_chunk(self, chunk_id):
        return self.current if chunk_id == "chunk-1" else None

    async def get_adjacent_chunks(self, chunk, before, after):
        return [chunk]

    async def list_documents(self, knowledge_base_id, limit, cursor):
        return ([{"document_id": "doc-1"}], None)


class FakeReranker:
    model_id = "fake-reranker"

    def __init__(self, scores=None, fail: bool = False) -> None:
        self.calls = []
        self.scores = scores
        self.fail = fail

    async def rerank(self, query, documents):
        self.calls.append((query, list(documents)))
        if self.fail:
            raise ConnectionError("secret reranker message")
        if self.scores is not None:
            return self.scores
        return [1.0 for _ in documents]


@pytest.mark.asyncio
async def test_search_uses_dual_recall_rrf_and_second_pass_vector_score() -> None:
    repository = FakeRepository()
    embedding = FakeEmbedding()
    service = RetrievalService(repository, embedding, score_threshold=0.0)

    result = await service.search_evidence("When did Apollo migrate?", "kb-1", 3)
    data = search_result_to_dict(result)

    assert result.status == "ok"
    assert result.degraded is False
    assert result.results[0].term_score > 0
    assert result.results[0].vector_score == 0.9
    assert result.results[0].score == pytest.approx(
        0.7 * result.results[0].term_score + 0.3 * 0.9
    )
    assert data["results"][0]["snippet"] == "Apollo migrated in July."
    assert data["degraded"] is False
    assert repository.lexical_calls[0][3] == 64
    assert repository.knn_calls[0][3] == 64
    assert repository.vector_calls[0][2] == ["chunk-1"]


def test_field_aware_term_score_rewards_questions_and_keywords() -> None:
    chunk = _chunk("chunk-1", content="unrelated body", ordinal=1)
    rich = field_aware_term_score("when did apollo migrate", chunk)
    empty = field_aware_term_score(
        "when did apollo migrate",
        Chunk(
            **{
                **chunk.__dict__,
                "important_kwd": (),
                "important_tks": "",
                "question_kwd": (),
                "question_tks": "",
                "title_tks": "",
                "title_sm_tks": "",
                "content_ltks": "",
                "content_sm_ltks": "",
            }
        ),
    )
    assert 0 <= empty < rich <= 1


@pytest.mark.asyncio
async def test_embedding_errors_are_redacted() -> None:
    service = RetrievalService(FakeRepository(), FakeEmbedding(fail=True))
    with pytest.raises(
        RetrievalError, match="retrieval service unavailable"
    ) as exc_info:
        await service.search_evidence("apollo", "kb-1")
    assert "secret provider" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_citation_context_returns_only_original_content() -> None:
    service = RetrievalService(FakeRepository(), FakeEmbedding())
    result = await service.get_citation_context("chunk-1")
    assert result[0]["content"] == "Apollo migrated in July."
    assert "question_kwd" not in result[0]


@pytest.mark.asyncio
async def test_rrf_fusion_preserves_lexical_only_candidates() -> None:
    repository = FakeRepository()
    lexical_only = _chunk("chunk-2", content="Lexical only hit.", ordinal=2)

    async def lexical_search(query, knowledge_base_id, filters, limit):
        return [
            RankedChunk(repository.current, 1, 12.0),
            RankedChunk(lexical_only, 2, 6.0),
        ]

    async def knn_search(vector, knowledge_base_id, filters, limit):
        return [RankedChunk(repository.current, 1, 0.9)]

    repository.lexical_search = lexical_search
    repository.knn_search = knn_search
    service = RetrievalService(repository, FakeEmbedding(), score_threshold=0.0)

    result = await service.search_evidence("apollo", "kb-1", 8)

    assert {item.chunk_id for item in result.results} == {"chunk-1", "chunk-2"}
    assert result.total_candidates == 2


def test_rrf_fuse_is_deterministic_and_unions_rankings() -> None:
    first = _chunk("chunk-1", content="a", ordinal=1)
    second = _chunk("chunk-2", content="b", ordinal=2)
    fused = rrf_fuse(
        (
            [RankedChunk(first, 1, 10.0), RankedChunk(second, 2, 5.0)],
            [RankedChunk(second, 1, 0.9)],
        ),
        k=60,
    )
    assert [item.chunk.chunk_id for item in fused] == ["chunk-2", "chunk-1"]
    assert fused[0].score == pytest.approx(1 / 62 + 1 / 61)
    assert fused[0].rank == 1 and fused[1].rank == 2


@pytest.mark.asyncio
async def test_reranker_orders_results_and_marks_scores() -> None:
    repository = FakeRepository()
    other = _chunk("chunk-2", content="Weaker hit.", ordinal=2)
    lexical_hits = [RankedChunk(repository.current, 1, 12.0)]
    knn_hits = [
        RankedChunk(repository.current, 1, 0.9),
        RankedChunk(other, 2, 0.8),
    ]
    repository.lexical_search = lambda *args: _as_async(lexical_hits)
    repository.knn_search = lambda *args: _as_async(knn_hits)
    reranker = FakeReranker(scores=[0.5, 3.0])
    service = RetrievalService(
        repository, FakeEmbedding(), reranker=reranker, score_threshold=0.0
    )

    result = await service.search_evidence("apollo", "kb-1", 8)

    assert result.degraded is False
    assert [item.chunk_id for item in result.results] == ["chunk-2", "chunk-1"]
    assert result.results[0].score == pytest.approx(1 / (1 + math.exp(-3.0)))
    assert len(reranker.calls[0][1]) == 2
    assert reranker.calls[0][1][0].startswith("[Migration]")


@pytest.mark.asyncio
async def test_reranker_failure_falls_back_to_fusion_and_marks_degraded() -> None:
    repository = FakeRepository()
    service = RetrievalService(
        repository,
        FakeEmbedding(),
        reranker=FakeReranker(fail=True),
        score_threshold=0.0,
    )

    result = await service.search_evidence("When did Apollo migrate?", "kb-1", 3)

    assert result.status == "ok"
    assert result.degraded is True
    assert result.results[0].chunk_id == "chunk-1"
    assert result.results[0].score == pytest.approx(
        0.7 * result.results[0].term_score + 0.3 * 0.9
    )


@pytest.mark.asyncio
async def test_document_folding_caps_chunks_per_document() -> None:
    repository = FakeRepository()
    sibling = _chunk("chunk-2", content="Same document hit.", ordinal=2)
    repository.lexical_search = lambda *args: _as_async(
        [RankedChunk(repository.current, 1, 12.0), RankedChunk(sibling, 2, 11.0)]
    )
    service = RetrievalService(
        repository,
        FakeEmbedding(),
        score_threshold=0.0,
        max_chunks_per_document=1,
    )

    result = await service.search_evidence("apollo", "kb-1", 8)

    assert [item.chunk_id for item in result.results] == ["chunk-1"]


async def _as_async(value):
    return value
