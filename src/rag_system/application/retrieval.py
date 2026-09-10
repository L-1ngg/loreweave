from __future__ import annotations

import asyncio
from dataclasses import asdict
import math
import re
from typing import Any, Sequence

from ..domain.fusion import rrf_fuse
from ..domain.lexical import fine_tokens
from ..domain.models import (
    Chunk,
    Evidence,
    QueryContext,
    QueryPlan,
    RankedChunk,
    SearchEvidenceResult,
)
from ..domain.ports import EmbeddingProvider, RerankerProvider, SearchRepository
from ..domain.query_understanding import QueryUnderstandingService
from ..processing.chunking import retrieval_text_for_chunk


LEXICAL_BOOSTS = {
    "important_kwd": 30,
    "important_tks": 20,
    "question_tks": 20,
    "title_tks": 10,
    "title_sm_tks": 5,
    "content_ltks": 2,
    "content_sm_ltks": 1,
}
TERM_FIELD_WEIGHTS = {"content": 1.0, "title": 2.0, "important": 5.0, "questions": 6.0}


class RetrievalError(RuntimeError):
    """Raised when a retrieval dependency fails without exposing provider details."""


class RetrievalService:
    def __init__(
        self,
        repository: SearchRepository,
        embedding_provider: EmbeddingProvider,
        *,
        query_understanding: QueryUnderstandingService | None = None,
        document_repository: Any | None = None,
        reranker: RerankerProvider | None = None,
        candidate_k: int = 64,
        default_top_k: int = 8,
        score_threshold: float = 0.2,
        term_weight: float = 0.7,
        vector_weight: float = 0.3,
        snippet_chars: int = 1600,
        rerank_top_n: int = 50,
        rrf_k: int = 60,
        max_chunks_per_document: int = 0,
    ) -> None:
        if abs(term_weight + vector_weight - 1.0) > 1e-9:
            raise ValueError("term and vector weights must sum to 1")
        if rerank_top_n < 1:
            raise ValueError("rerank top_n must be positive")
        if rrf_k < 1:
            raise ValueError("rrf k must be positive")
        if max_chunks_per_document < 0:
            raise ValueError("max chunks per document cannot be negative")
        self._repository = repository
        self._embedding_provider = embedding_provider
        self._query_understanding = query_understanding or QueryUnderstandingService()
        self._document_repository = document_repository
        self._reranker = reranker
        self._candidate_k = candidate_k
        self._default_top_k = default_top_k
        self._score_threshold = score_threshold
        self._term_weight = term_weight
        self._vector_weight = vector_weight
        self._snippet_chars = snippet_chars
        self._rerank_top_n = rerank_top_n
        self._rrf_k = rrf_k
        self._max_chunks_per_document = max_chunks_per_document

    async def search_evidence(
        self,
        query: str,
        knowledge_base_id: str = "default",
        top_k: int | None = None,
        *,
        explicit_filters: dict[str, Any] | None = None,
        context: Sequence[QueryContext] = (),
    ) -> SearchEvidenceResult:
        _validate_knowledge_base_id(knowledge_base_id)
        result_limit = top_k if top_k is not None else self._default_top_k
        if not 1 <= result_limit <= 20:
            raise ValueError("top_k must be between 1 and 20")
        plan, next_context = await self._query_understanding.build_plan(
            query,
            knowledge_base_id,
            explicit_filters=explicit_filters,
            context=context,
        )
        if plan.filters.get("__empty__"):
            return _empty_result(plan, next_context, knowledge_base_id)

        try:
            vectors = await self._embedding_provider.embed([plan.semantic_query])
        except Exception as exc:
            raise RetrievalError("retrieval service unavailable") from exc
        if len(vectors) != 1:
            raise RetrievalError("retrieval service unavailable")
        vector = vectors[0]
        try:
            lexical_hits, vector_hits = await asyncio.gather(
                self._repository.lexical_search(
                    plan.lexical_query,
                    knowledge_base_id,
                    plan.filters,
                    self._candidate_k,
                ),
                self._repository.knn_search(
                    vector,
                    knowledge_base_id,
                    plan.filters,
                    self._candidate_k,
                ),
            )
            candidates = rrf_fuse((lexical_hits, vector_hits), k=self._rrf_k)
            vector_scores = await self._repository.vector_scores(
                vector,
                knowledge_base_id,
                [item.chunk.chunk_id for item in candidates],
                plan.filters,
            )
        except Exception as exc:
            raise RetrievalError("retrieval service unavailable") from exc
        return await self._rerank(
            plan,
            next_context,
            knowledge_base_id,
            candidates,
            vector_scores,
            result_limit,
        )

    async def _rerank(
        self,
        plan: QueryPlan,
        next_context: QueryContext,
        knowledge_base_id: str,
        candidates: list[RankedChunk],
        vector_scores: dict[str, float],
        limit: int,
    ) -> SearchEvidenceResult:
        degraded = False
        scored: list[tuple[float, float, float, Chunk]] = []
        if self._reranker is not None and candidates:
            try:
                ranked = candidates[: self._rerank_top_n]
                rerank_scores = await self._reranker.rerank(
                    plan.semantic_query,
                    [retrieval_text_for_chunk(item.chunk) for item in ranked],
                )
                for item, rerank_score in zip(ranked, rerank_scores, strict=True):
                    final = _sigmoid(rerank_score)
                    if final >= self._score_threshold:
                        scored.append(
                            (
                                final,
                                field_aware_term_score(plan.semantic_query, item.chunk),
                                _normalize_vector_score(
                                    vector_scores.get(item.chunk.chunk_id, 0.0)
                                ),
                                item.chunk,
                            )
                        )
            except Exception:
                degraded = True
                scored = []
        if self._reranker is None or degraded:
            for item in candidates:
                term = field_aware_term_score(plan.semantic_query, item.chunk)
                vector = _normalize_vector_score(
                    vector_scores.get(item.chunk.chunk_id, 0.0)
                )
                score = self._term_weight * term + self._vector_weight * vector
                if score >= self._score_threshold:
                    scored.append((score, term, vector, item.chunk))
        scored.sort(key=lambda item: (-item[0], item[3].chunk_id))
        selected = _fold_documents(scored, self._max_chunks_per_document)[:limit]
        evidence = tuple(
            _evidence(rank, values, self._snippet_chars)
            for rank, values in enumerate(selected, 1)
        )
        if evidence:
            status = "ok"
        elif candidates:
            status = "weak"
        else:
            status = "empty"
        return SearchEvidenceResult(
            status=status,
            resolved_query=plan.resolved_query,
            query_plan=plan,
            knowledge_base_id=knowledge_base_id,
            results=evidence,
            next_context=next_context,
            total_candidates=len(candidates),
            truncated=len(scored) > limit,
            degraded=degraded,
        )

    async def get_citation_context(
        self, chunk_id: str, before: int = 1, after: int = 1
    ) -> list[dict]:
        if not 0 <= before <= 3 or not 0 <= after <= 3:
            raise ValueError("before and after must be between 0 and 3")
        try:
            chunk = await self._repository.get_chunk(chunk_id)
            if chunk is None:
                raise LookupError(f"chunk {chunk_id!r} was not found")
            chunks = await self._repository.get_adjacent_chunks(chunk, before, after)
        except LookupError:
            raise
        except Exception as exc:
            raise RetrievalError("retrieval service unavailable") from exc
        if all(item.chunk_id != chunk.chunk_id for item in chunks):
            chunks.append(chunk)
            chunks.sort(key=_citation_order)
        return [_citation_chunk(item) for item in chunks]

    async def list_documents(
        self,
        knowledge_base_id: str = "default",
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict:
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        _validate_knowledge_base_id(knowledge_base_id)
        repository = self._document_repository or self._repository
        try:
            documents, next_cursor = await repository.list_documents(
                knowledge_base_id, limit, cursor
            )
        except ValueError:
            raise
        except Exception as exc:
            raise RetrievalError("retrieval service unavailable") from exc
        return {"documents": documents, "next_cursor": next_cursor}


def field_aware_term_score(query: str, chunk: Chunk) -> float:
    query_tokens = fine_tokens(query)
    if not query_tokens:
        return 0.0
    query_unigrams = list(dict.fromkeys(query_tokens))
    query_bigrams = list(dict.fromkeys(zip(query_tokens, query_tokens[1:])))
    fields = {
        "content": [*chunk.content_ltks.split(), *chunk.content_sm_ltks.split()],
        "title": [*chunk.title_tks.split(), *chunk.title_sm_tks.split()],
        "important": [
            *chunk.important_tks.split(),
            *fine_tokens(" ".join(chunk.important_kwd)),
        ],
        "questions": [
            *chunk.question_tks.split(),
            *fine_tokens(" ".join(chunk.question_kwd)),
        ],
    }
    weighted = 0.0
    total_weight = sum(TERM_FIELD_WEIGHTS.values())
    for field, tokens in fields.items():
        token_set = set(tokens)
        unigram_coverage = sum(token in token_set for token in query_unigrams) / len(
            query_unigrams
        )
        if query_bigrams:
            field_bigrams = set(zip(tokens, tokens[1:]))
            bigram_coverage = sum(
                pair in field_bigrams for pair in query_bigrams
            ) / len(query_bigrams)
            coverage = 0.4 * unigram_coverage + 0.6 * bigram_coverage
        else:
            coverage = unigram_coverage
        weighted += TERM_FIELD_WEIGHTS[field] * coverage
    return round(min(1.0, max(0.0, weighted / total_weight)), 8)


def search_result_to_dict(result: SearchEvidenceResult) -> dict[str, Any]:
    """Convert a search result into the MCP response contract."""

    return asdict(result)


def _empty_result(
    plan: QueryPlan, next_context: QueryContext, knowledge_base_id: str
) -> SearchEvidenceResult:
    return SearchEvidenceResult(
        status="empty",
        resolved_query=plan.resolved_query,
        query_plan=plan,
        knowledge_base_id=knowledge_base_id,
        results=(),
        next_context=next_context,
    )


def _evidence(
    rank: int, values: tuple[float, float, float, Chunk], snippet_chars: int
) -> Evidence:
    score, term, vector, chunk = values
    citation = chunk.content_with_weight or chunk.content
    return Evidence(
        rank=rank,
        chunk_id=chunk.chunk_id,
        document_id=chunk.document_id,
        document_revision_id=chunk.document_revision_id,
        title=chunk.title,
        snippet=citation[:snippet_chars],
        page_start=chunk.page_start,
        page_end=chunk.page_end,
        section_path=chunk.section_path,
        source_uri=(
            f"rag://documents/{chunk.document_id}/revisions/"
            f"{chunk.document_revision_id}"
        ),
        score=round(score, 8),
        term_score=round(term, 8),
        vector_score=round(vector, 8),
        asset_refs=chunk.asset_refs,
    )


def _citation_chunk(chunk: Chunk) -> dict[str, Any]:
    return {
        "chunk_id": chunk.chunk_id,
        "document_id": chunk.document_id,
        "document_revision_id": chunk.document_revision_id,
        "title": chunk.title,
        "content": chunk.content_with_weight or chunk.content,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "section_path": list(chunk.section_path),
        "asset_refs": list(chunk.asset_refs),
        "source_uri": (
            f"rag://documents/{chunk.document_id}/revisions/"
            f"{chunk.document_revision_id}"
        ),
    }


def _normalize_vector_score(value: float) -> float:
    # Elasticsearch cosine kNN scores are normally already (1 + cosine) / 2.
    return min(1.0, max(0.0, float(value)))


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    return math.exp(value) / (1.0 + math.exp(value))


def _fold_documents(
    scored: list[tuple[float, float, float, Chunk]], max_per_document: int
) -> list[tuple[float, float, float, Chunk]]:
    if max_per_document < 1:
        return scored
    counts: dict[str, int] = {}
    selected: list[tuple[float, float, float, Chunk]] = []
    for item in scored:
        document_id = item[3].document_id
        if counts.get(document_id, 0) >= max_per_document:
            continue
        counts[document_id] = counts.get(document_id, 0) + 1
        selected.append(item)
    return selected


def _citation_order(chunk: Chunk) -> tuple[int, str]:
    ordinal = chunk.metadata.get("chunk_ordinal")
    if not isinstance(ordinal, int):
        ordinal = 2**31 - 1
    return ordinal, chunk.chunk_id


_KNOWLEDGE_BASE_ID = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$")


def _validate_knowledge_base_id(knowledge_base_id: str) -> None:
    if not _KNOWLEDGE_BASE_ID.fullmatch(knowledge_base_id):
        raise ValueError("knowledge_base_id must be 1 to 128 URL-safe characters")
