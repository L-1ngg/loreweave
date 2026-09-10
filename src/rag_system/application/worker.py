from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any

from ..domain.models import Chunk
from ..domain.query_understanding import EntityAliasMatcher
from ..infrastructure.database import OutboxEvent, PostgresRepository
from ..infrastructure.elasticsearch_store import ElasticsearchRepository
from ..infrastructure.object_store import S3ObjectStore
from ..processing.artifacts import load_embedded_artifact


class ProjectionWorker:
    def __init__(
        self,
        *,
        repository: PostgresRepository,
        search: ElasticsearchRepository,
        object_store: S3ObjectStore,
        worker_id: str,
        lease_seconds: int = 60,
    ) -> None:
        self._repository = repository
        self._search = search
        self._object_store = object_store
        self._worker_id = worker_id
        self._lease_seconds = lease_seconds

    async def process_one(self) -> bool:
        event = await self._repository.claim_outbox(
            worker_id=self._worker_id,
            lease_seconds=self._lease_seconds,
        )
        if event is None:
            return False
        activated = False
        try:
            await self._process(event)
            activation = await self._repository.activate_projection(event.aggregate_id)
            activated = True
            if activation.active and activation.superseded_revision_ids:
                await self._search.delete_revisions(
                    activation.superseded_revision_ids,
                    refresh=True,
                )
            elif not activation.active:
                await self._search.delete_revision(
                    event.aggregate_id,
                    refresh=True,
                )
            await self._repository.complete_projection(
                event.event_id, event.aggregate_id
            )
        except Exception as exc:
            retry = event.attempts < 5
            await self._repository.fail_outbox(
                event.event_id,
                _error_summary(exc),
                retry=retry,
            )
            if not retry and not activated:
                await self._repository.mark_projection_failed(
                    event.aggregate_id, _error_summary(exc)
                )
            return True
        return True

    async def _process(self, event: OutboxEvent) -> None:
        if event.event_type not in {
            "chunk_projection.upsert",
            "chunk_projection.rebuild",
        }:
            raise ValueError(f"unsupported outbox event {event.event_type!r}")
        payload, chunks = await _load_projection(self._object_store, event.payload)
        if payload.get("revision_id") != event.aggregate_id:
            raise ValueError("outbox revision does not match artifact")
        knowledge_base_id = str(event.payload.get("knowledge_base_id") or "")
        records = await self._repository.list_entity_aliases(knowledge_base_id)
        matcher = EntityAliasMatcher(records)
        projected, entity_refs = _apply_entity_aliases(chunks, matcher)
        await self._search.project_chunks(projected, refresh="wait_for")
        await self._repository.link_document_entities(
            knowledge_base_id=knowledge_base_id,
            revision_id=event.aggregate_id,
            entity_refs=list(dict.fromkeys(entity_refs)),
        )
        await self._repository.mark_projection_indexed(event.aggregate_id)

    async def run(self, *, poll_seconds: float, stop: asyncio.Event) -> None:
        await self._search.ensure_index()
        while not stop.is_set():
            processed = await self.process_one()
            if not processed:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
                except TimeoutError:
                    pass


@dataclass(frozen=True)
class RebuildReport:
    index: str
    knowledge_base_id: str | None
    revision_count: int
    expected_chunks: int
    indexed_chunks: int
    expected_checksum_count: int
    indexed_checksum_count: int
    matched_checksums: int
    missing_checksums: int
    unexpected_checksums: int
    projection_coverage: float
    verified: bool


class IndexManager:
    def __init__(
        self,
        *,
        repository: PostgresRepository,
        search: ElasticsearchRepository,
        object_store: S3ObjectStore,
    ) -> None:
        self._repository = repository
        self._search = search
        self._object_store = object_store

    async def rebuild(self, *, new_index: str | None = None) -> RebuildReport:
        new_index = new_index or (
            f"{self._search.chunks_index}-rebuild-"
            f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
        )
        await self._search.create_physical_index(new_index)
        revisions = await self._repository.list_projection_revisions()
        expected = 0
        matchers: dict[str, EntityAliasMatcher] = {}
        for revision in revisions:
            payload, chunks = await _load_projection(self._object_store, revision)
            if payload.get("revision_id") != revision["revision_id"]:
                raise ValueError("revision artifact identity mismatch")
            expected += len(chunks)
            knowledge_base_id = str(
                revision.get("knowledge_base_id")
                or (chunks[0].knowledge_base_id if chunks else "")
            )
            if not knowledge_base_id:
                raise ValueError("revision projection has no knowledge base identity")
            if knowledge_base_id not in matchers:
                records = await self._repository.list_entity_aliases(knowledge_base_id)
                matchers[knowledge_base_id] = EntityAliasMatcher(records)
            projected, _ = _apply_entity_aliases(chunks, matchers[knowledge_base_id])
            await self._search.project_chunks(
                projected, index=new_index, refresh="wait_for"
            )
        report = await self.verify(new_index)
        if not report.verified:
            raise RuntimeError(
                "rebuild verification failed: "
                f"expected {expected} chunks, found {report.indexed_chunks}"
            )
        return report

    async def verify(
        self, index: str, knowledge_base_id: str | None = None
    ) -> RebuildReport:
        revisions = await self._repository.list_projection_revisions(knowledge_base_id)
        expected = 0
        expected_checksums: list[str] = []
        for revision in revisions:
            _, chunks = await _load_projection(self._object_store, revision)
            expected += len(chunks)
            expected_checksums.extend(
                chunk.checksum for chunk in chunks if chunk.checksum
            )
        indexed = await self._search.count_chunks(
            index=index, knowledge_base_id=knowledge_base_id
        )
        actual_checksums = await self._search.list_chunk_checksums(
            index=index, knowledge_base_id=knowledge_base_id
        )
        expected_counter = Counter(expected_checksums)
        actual_counter = Counter(actual_checksums)
        matched_checksums = sum((expected_counter & actual_counter).values())
        missing_checksums = sum((expected_counter - actual_counter).values())
        unexpected_checksums = sum((actual_counter - expected_counter).values())
        projection_coverage = (
            matched_checksums / expected if expected else (1.0 if indexed == 0 else 0.0)
        )
        return RebuildReport(
            index=index,
            knowledge_base_id=knowledge_base_id,
            revision_count=len(revisions),
            expected_chunks=expected,
            indexed_chunks=indexed,
            expected_checksum_count=len(expected_checksums),
            indexed_checksum_count=len(actual_checksums),
            matched_checksums=matched_checksums,
            missing_checksums=missing_checksums,
            unexpected_checksums=unexpected_checksums,
            projection_coverage=round(projection_coverage, 8),
            verified=indexed == expected
            and len(expected_checksums) == expected
            and len(actual_checksums) == indexed
            and missing_checksums == 0
            and unexpected_checksums == 0,
        )

    async def cutover(self, index: str) -> list[str]:
        report = await self.verify(index)
        if not report.verified:
            raise RuntimeError(
                "cutover verification failed: "
                f"expected {report.expected_chunks} chunks, "
                f"found {report.indexed_chunks}"
            )
        old = await self._search.current_alias_indices()
        await self._search.cutover_alias(index, old_indices=old)
        return old


async def _load_projection(object_store: S3ObjectStore, metadata: dict[str, Any]):
    key = str(metadata.get("artifact_object_key") or "")
    expected_checksum = str(metadata.get("artifact_checksum") or "")
    if not key or not expected_checksum:
        raise ValueError("projection metadata is missing artifact identity")
    data = await object_store.get_bytes(key)
    if sha256(data).hexdigest() != expected_checksum:
        raise ValueError("embedded chunks object checksum mismatch")
    payload, chunks = load_embedded_artifact(data)
    if metadata.get("chunk_count") not in {None, len(chunks)}:
        raise ValueError("projection metadata chunk count mismatch")
    return payload, chunks


def _apply_entity_aliases(
    chunks: tuple[Chunk, ...], matcher: EntityAliasMatcher
) -> tuple[list[Chunk], list[str]]:
    projected: list[Chunk] = []
    entity_refs: list[str] = []
    for chunk in chunks:
        hits, _ = matcher.match(chunk.content_with_weight or chunk.content)
        refs = tuple(
            dict.fromkeys([*chunk.entity_refs, *(hit.entity_ref for hit in hits)])
        )
        projected.append(replace(chunk, entity_refs=refs))
        entity_refs.extend(refs)
    return projected, entity_refs


def _error_summary(exc: Exception) -> str:
    return (str(exc).replace("\n", " ").strip() or exc.__class__.__name__)[:1000]
