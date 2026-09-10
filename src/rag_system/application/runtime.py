from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..domain.ports import (
    EmbeddingProvider,
    ObjectStore,
    RemoteParser,
    SearchRepository,
)
from ..domain.query_understanding import QueryUnderstandingService
from ..infrastructure.config import Settings
from ..infrastructure.database import PostgresRepository
from ..infrastructure.database_migrations import ALEMBIC_HEAD
from ..infrastructure.elasticsearch_store import ElasticsearchRepository
from ..infrastructure.object_store import S3ObjectStore
from ..infrastructure.providers.chat_provider import OpenAICompatibleChatProvider
from ..infrastructure.providers.embeddings import OpenAICompatibleEmbeddingProvider
from ..infrastructure.providers.mineru import MinerUParser
from ..infrastructure.providers.reranker import HttpRerankerProvider
from .generation import GenerationService
from .ingestion import IngestionService
from .retrieval import RetrievalService


@dataclass
class RetrievalRuntime:
    settings: Settings
    repository: SearchRepository
    business_repository: PostgresRepository
    embedding_provider: EmbeddingProvider
    retrieval: RetrievalService
    chat_provider: OpenAICompatibleChatProvider | None = None
    _closeables: tuple[object, ...] = ()

    async def close(self) -> None:
        seen: set[int] = set()
        for item in self._closeables:
            if id(item) in seen:
                continue
            seen.add(id(item))
            close = getattr(item, "close", None) or getattr(item, "aclose", None)
            if close is not None:
                result = close()
                if hasattr(result, "__await__"):
                    await result


@dataclass
class IngestionRuntime(RetrievalRuntime):
    object_store: ObjectStore | None = None
    parser: RemoteParser | None = None
    ingestion: IngestionService | None = None


@dataclass
class GenerationRuntime(RetrievalRuntime):
    generation_provider: OpenAICompatibleChatProvider | None = None
    generation: GenerationService | None = None


def _chat_from_settings(settings: Settings) -> OpenAICompatibleChatProvider | None:
    if (
        not settings.chat.base_url
        or not settings.chat.api_key
        or not settings.indexing.enrichment.model
    ):
        return None
    return OpenAICompatibleChatProvider.from_settings(settings)


def build_retrieval_runtime(settings: Settings | None = None) -> RetrievalRuntime:
    settings = settings or Settings.from_env()
    settings.validate_storage().validate_embedding().validate_retrieval()
    business = PostgresRepository.from_settings(settings)
    repository = ElasticsearchRepository.from_settings(settings)
    embedding_provider = OpenAICompatibleEmbeddingProvider.from_settings(settings)
    chat_provider = _chat_from_settings(settings)
    relative_base = None
    if settings.retrieval.relative_base:
        relative_base = datetime.fromisoformat(
            settings.retrieval.relative_base.replace("Z", "+00:00")
        )
    understanding = QueryUnderstandingService(
        alias_provider=business,
        chat_provider=chat_provider,
        relative_base=relative_base,
        timezone=settings.retrieval.timezone,
    )
    reranker = (
        HttpRerankerProvider.from_settings(settings)
        if settings.retrieval.rerank.enabled
        else None
    )
    retrieval = RetrievalService(
        repository,
        embedding_provider,
        query_understanding=understanding,
        document_repository=business,
        reranker=reranker,
        candidate_k=settings.retrieval.candidate_k,
        default_top_k=settings.retrieval.top_k,
        score_threshold=settings.retrieval.score_threshold,
        term_weight=settings.retrieval.term_weight,
        vector_weight=settings.retrieval.vector_weight,
        rerank_top_n=settings.retrieval.rerank.top_n,
        rrf_k=settings.retrieval.rerank.rrf_k,
        max_chunks_per_document=settings.retrieval.rerank.max_chunks_per_document,
    )
    return RetrievalRuntime(
        settings=settings,
        repository=repository,
        business_repository=business,
        embedding_provider=embedding_provider,
        retrieval=retrieval,
        chat_provider=chat_provider,
        _closeables=(repository.client, business, chat_provider),
    )


def build_generation_runtime(settings: Settings | None = None) -> GenerationRuntime:
    settings = settings or Settings.from_env()
    (
        settings.validate_storage()
        .validate_embedding()
        .validate_retrieval()
        .validate_generation()
    )
    retrieval_runtime = build_retrieval_runtime(settings)
    generation_provider = OpenAICompatibleChatProvider.from_generation_settings(
        settings
    )
    generation = GenerationService(
        retrieval_runtime.retrieval,
        generation_provider,
        prompt_version=settings.generation.prompt_version,
    )
    return GenerationRuntime(
        settings=settings,
        repository=retrieval_runtime.repository,
        business_repository=retrieval_runtime.business_repository,
        embedding_provider=retrieval_runtime.embedding_provider,
        retrieval=retrieval_runtime.retrieval,
        chat_provider=retrieval_runtime.chat_provider,
        generation_provider=generation_provider,
        generation=generation,
        _closeables=(*retrieval_runtime._closeables, generation_provider),
    )


def build_ingestion_runtime(settings: Settings | None = None) -> IngestionRuntime:
    settings = settings or Settings.from_env()
    settings.validate()
    retrieval_runtime = build_retrieval_runtime(settings)
    object_store = S3ObjectStore.from_settings(settings)
    parser = MinerUParser.from_settings(settings)
    ingestion = IngestionService(
        settings,
        repository=retrieval_runtime.business_repository,
        object_store=object_store,
        parser=parser,
        embedding_provider=retrieval_runtime.embedding_provider,
        chat_provider=retrieval_runtime.chat_provider,
    )
    return IngestionRuntime(
        settings=settings,
        repository=retrieval_runtime.repository,
        business_repository=retrieval_runtime.business_repository,
        embedding_provider=retrieval_runtime.embedding_provider,
        retrieval=retrieval_runtime.retrieval,
        chat_provider=retrieval_runtime.chat_provider,
        object_store=object_store,
        parser=parser,
        ingestion=ingestion,
        _closeables=(
            retrieval_runtime.repository.client,
            retrieval_runtime.business_repository,
            parser,
            retrieval_runtime.chat_provider,
        ),
    )


async def validate_runtime_state(runtime: RetrievalRuntime) -> None:
    """Read-only startup checks used by MCP and diagnostics."""

    await runtime.business_repository.assert_migration_head(ALEMBIC_HEAD)
    await runtime.repository.validate_index()
