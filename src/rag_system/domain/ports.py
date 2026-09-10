from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol

from .models import (
    Chunk,
    DocumentRevision,
    IngestionJob,
    ParseArtifact,
    RankedChunk,
    RemoteParseTask,
)


class ObjectStore(Protocol):
    async def put_bytes(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> None: ...

    async def get_bytes(self, key: str) -> bytes: ...

    async def exists(self, key: str) -> bool: ...

    async def presign_get(self, key: str, expires_in: int) -> str: ...


class RemoteParser(Protocol):
    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask: ...

    async def get_task(self, task_id: str) -> RemoteParseTask: ...

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact: ...


class EmbeddingProvider(Protocol):
    @property
    def profile_id(self) -> str: ...

    @property
    def dimensions(self) -> int: ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class ChatProvider(Protocol):
    @property
    def model_id(self) -> str: ...

    async def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]: ...


class GenerationProvider(ChatProvider, Protocol):
    """Structured chat capability used for online answer generation."""


class RerankerProvider(Protocol):
    @property
    def model_id(self) -> str: ...

    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]: ...


class EnrichmentCache(Protocol):
    async def get_enrichment_cache(self, cache_key: str) -> dict[str, Any] | None: ...

    async def put_enrichment_cache(
        self,
        cache_key: str,
        *,
        content_sha256: str,
        chat_model: str,
        prompt_version: str,
        language: str,
        keyword_top_n: int,
        question_top_n: int,
        result: dict[str, Any],
    ) -> None: ...


class BusinessRepository(EnrichmentCache, Protocol):
    async def save_job(self, job: IngestionJob) -> None: ...

    async def find_completed_revision(
        self,
        knowledge_base_id: str,
        document_id: str,
        source_sha256: str,
        revision_fingerprint: str,
    ) -> DocumentRevision | None: ...

    async def save_revision_projection(
        self,
        revision: DocumentRevision,
        *,
        chunk_count: int,
        artifact_object_key: str,
        artifact_checksum: str,
        job: IngestionJob,
    ) -> None: ...

    async def list_entity_aliases(
        self, knowledge_base_id: str
    ) -> list[dict[str, Any]]: ...

    async def upsert_entity(
        self,
        *,
        knowledge_base_id: str,
        entity_type: str,
        canonical_name: str,
        aliases: list[str],
        entity_ref: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str: ...

    async def list_documents(
        self, knowledge_base_id: str, limit: int, cursor: str | None
    ) -> tuple[list[dict], str | None]: ...


class SearchRepository(Protocol):
    async def ensure_index(self) -> None: ...

    async def validate_index(self) -> None: ...

    async def lexical_search(
        self,
        query: str,
        knowledge_base_id: str,
        filters: dict[str, Any],
        limit: int,
    ) -> list[RankedChunk]: ...

    async def knn_search(
        self,
        vector: Sequence[float],
        knowledge_base_id: str,
        filters: dict[str, Any],
        limit: int,
    ) -> list[RankedChunk]: ...

    async def vector_scores(
        self,
        vector: Sequence[float],
        knowledge_base_id: str,
        candidate_ids: Sequence[str],
        filters: dict[str, Any],
    ) -> dict[str, float]: ...

    async def get_chunk(self, chunk_id: str) -> Chunk | None: ...

    async def get_adjacent_chunks(
        self, chunk: Chunk, before: int, after: int
    ) -> list[Chunk]: ...
