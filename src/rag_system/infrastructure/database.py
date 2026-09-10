from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
import base64
import binascii
import hashlib
import json
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    Integer,
    String,
    Text,
    and_,
    delete,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import Settings
from ..domain.models import (
    DocumentBlock,
    DocumentRevision,
    IngestionJob,
    JobStatus,
)


class Base(DeclarativeBase):
    pass


class DocumentRow(Base):
    __tablename__ = "documents"

    document_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(128), index=True)
    current_revision_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title: Mapped[str] = mapped_column(Text, default="")
    source_name: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DocumentRevisionRow(Base):
    __tablename__ = "document_revisions"

    document_revision_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(160), index=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(128), index=True)
    source_sha256: Mapped[str] = mapped_column(String(64), index=True)
    revision_fingerprint: Mapped[str] = mapped_column(String(128), index=True)
    source_object_key: Mapped[str] = mapped_column(Text)
    source_name: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    parser_provider: Mapped[str] = mapped_column(String(80))
    parser_version: Mapped[str] = mapped_column(String(160))
    enrichment_profile_id: Mapped[str] = mapped_column(String(160), default="disabled")
    status: Mapped[str] = mapped_column(String(40), default="CHUNKED")
    blocks_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    artifact_object_key: Mapped[str] = mapped_column(Text, default="")
    artifact_checksum: Mapped[str] = mapped_column(String(64), default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class IngestionJobRow(Base):
    __tablename__ = "ingestion_jobs"

    job_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(160), index=True)
    document_revision_id: Mapped[str] = mapped_column(String(160), index=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(128), index=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    source_name: Mapped[str] = mapped_column(Text)
    source_object_key: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40))
    parse_provider: Mapped[str] = mapped_column(String(80), default="mineru")
    parse_task_id: Mapped[str] = mapped_column(String(240), default="")
    parse_result_object_key: Mapped[str] = mapped_column(Text, default="")
    embedding_profile_id: Mapped[str] = mapped_column(String(160), default="")
    enrichment_profile_id: Mapped[str] = mapped_column(String(160), default="disabled")
    revision_fingerprint: Mapped[str] = mapped_column(String(128), default="")
    chunking_version: Mapped[str] = mapped_column(String(80), default="")
    embedded_chunks_object_key: Mapped[str] = mapped_column(Text, default="")
    embedded_chunks_checksum: Mapped[str] = mapped_column(String(64), default="")
    enrichment_status: Mapped[str] = mapped_column(String(40), default="skipped")
    enrichment_failed_chunks: Mapped[int] = mapped_column(Integer, default=0)
    enrichment_error_summary: Mapped[str] = mapped_column(Text, default="")
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error_code: Mapped[str] = mapped_column(String(120), default="")
    last_error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OutboxEventRow(Base):
    __tablename__ = "outbox_events"

    event_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    aggregate_id: Mapped[str] = mapped_column(String(160), index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    leased_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    leased_by: Mapped[str] = mapped_column(String(160), default="")
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EnrichmentCacheRow(Base):
    __tablename__ = "enrichment_cache"

    cache_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    chat_model: Mapped[str] = mapped_column(String(240))
    prompt_version: Mapped[str] = mapped_column(String(100))
    language: Mapped[str] = mapped_column(String(32))
    keyword_top_n: Mapped[int] = mapped_column(Integer)
    question_top_n: Mapped[int] = mapped_column(Integer)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EntityRow(Base):
    __tablename__ = "entities"

    knowledge_base_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    entity_ref: Mapped[str] = mapped_column(String(240), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(80))
    canonical_name: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EntityAliasRow(Base):
    __tablename__ = "entity_aliases"

    alias_id: Mapped[str] = mapped_column(String(240), primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(128), index=True)
    entity_ref: Mapped[str] = mapped_column(String(240), index=True)
    alias: Mapped[str] = mapped_column(Text)
    normalized_alias: Mapped[str] = mapped_column(Text, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DocumentEntityLinkRow(Base):
    __tablename__ = "document_entity_links"

    knowledge_base_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    document_revision_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    entity_ref: Mapped[str] = mapped_column(String(240), primary_key=True)
    source: Mapped[str] = mapped_column(String(40), default="ingestion")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


@dataclass(frozen=True)
class OutboxEvent:
    event_id: str
    event_type: str
    aggregate_id: str
    payload: dict[str, Any]
    attempts: int


@dataclass(frozen=True)
class ProjectionActivation:
    active: bool
    superseded_revision_ids: tuple[str, ...] = ()


class PostgresRepository:
    """Business source of truth and transactional outbox implementation."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine
        self.session_factory = async_sessionmaker(engine, expire_on_commit=False)

    @classmethod
    def from_settings(cls, settings: Settings) -> "PostgresRepository":
        return cls(
            create_async_engine(
                settings.storage.database_url.get_secret_value(),
                pool_pre_ping=True,
            )
        )

    async def close(self) -> None:
        await self.engine.dispose()

    async def create_schema_for_tests(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def save_job(self, job: IngestionJob) -> None:
        async with self.session_factory() as session:
            row = await session.get(IngestionJobRow, job.job_id)
            if row is None:
                row = IngestionJobRow(job_id=job.job_id)
                session.add(row)
            _copy_job(row, job)
            await session.commit()

    async def get_job_status(self, job_id: str) -> JobStatus | None:
        async with self.session_factory() as session:
            row = await session.get(IngestionJobRow, job_id)
            return JobStatus(row.status) if row is not None else None

    async def find_completed_revision(
        self,
        knowledge_base_id: str,
        document_id: str,
        source_sha256: str,
        revision_fingerprint: str,
    ) -> DocumentRevision | None:
        async with self.session_factory() as session:
            result = await session.execute(
                select(DocumentRevisionRow)
                .where(
                    DocumentRevisionRow.knowledge_base_id == knowledge_base_id,
                    DocumentRevisionRow.document_id == document_id,
                    DocumentRevisionRow.source_sha256 == source_sha256,
                    DocumentRevisionRow.revision_fingerprint == revision_fingerprint,
                    DocumentRevisionRow.status.in_(["COMPLETED", "INDEXED"]),
                )
                .order_by(DocumentRevisionRow.created_at.desc())
            )
            row = result.scalars().first()
            return _revision_from_row(row) if row else None

    async def save_revision_projection(
        self,
        revision: DocumentRevision,
        *,
        chunk_count: int,
        artifact_object_key: str,
        artifact_checksum: str,
        job: IngestionJob,
    ) -> None:
        now = datetime.now(UTC)
        async with self.session_factory() as session:
            document = await session.get(DocumentRow, revision.document_id)
            if document is None:
                document = DocumentRow(
                    document_id=revision.document_id,
                    knowledge_base_id=revision.knowledge_base_id,
                    title=revision.title,
                    source_name=revision.source_name,
                    metadata_json=revision.metadata,
                    created_at=revision.created_at,
                    updated_at=now,
                )
                session.add(document)
            row = await session.get(DocumentRevisionRow, revision.document_revision_id)
            if row is None:
                row = DocumentRevisionRow(
                    document_revision_id=revision.document_revision_id,
                    document_id=revision.document_id,
                    knowledge_base_id=revision.knowledge_base_id,
                    source_sha256=revision.source_sha256,
                    revision_fingerprint=revision.revision_fingerprint,
                    source_object_key=revision.source_object_key,
                    source_name=revision.source_name,
                    title=revision.title,
                    parser_provider=revision.parser_provider,
                    parser_version=revision.parser_version,
                    enrichment_profile_id=revision.enrichment_profile_id,
                    blocks_json=[asdict(block) for block in revision.blocks],
                    metadata_json=revision.metadata,
                    created_at=revision.created_at,
                )
                session.add(row)
            row.status = JobStatus.PROJECTION_PENDING.value
            row.artifact_object_key = artifact_object_key
            row.artifact_checksum = artifact_checksum
            row.chunk_count = chunk_count
            job.transition(JobStatus.PROJECTION_PENDING)
            job.embedded_chunks_object_key = artifact_object_key
            job.embedded_chunks_checksum = artifact_checksum
            job_row = await session.get(IngestionJobRow, job.job_id)
            if job_row is None:
                job_row = IngestionJobRow(job_id=job.job_id)
                session.add(job_row)
            _copy_job(job_row, job)
            event_id = f"projection:{revision.document_revision_id}"
            event = await session.get(OutboxEventRow, event_id)
            if event is None:
                session.add(
                    OutboxEventRow(
                        event_id=event_id,
                        event_type="chunk_projection.upsert",
                        aggregate_id=revision.document_revision_id,
                        payload_json={
                            "revision_id": revision.document_revision_id,
                            "knowledge_base_id": revision.knowledge_base_id,
                            "artifact_object_key": artifact_object_key,
                            "artifact_checksum": artifact_checksum,
                            "chunk_count": chunk_count,
                        },
                        status="pending",
                        available_at=now,
                        created_at=now,
                    )
                )
            else:
                event.event_type = "chunk_projection.upsert"
                event.aggregate_id = revision.document_revision_id
                event.payload_json = {
                    "revision_id": revision.document_revision_id,
                    "knowledge_base_id": revision.knowledge_base_id,
                    "artifact_object_key": artifact_object_key,
                    "artifact_checksum": artifact_checksum,
                    "chunk_count": chunk_count,
                }
                event.status = "pending"
                event.available_at = now
                event.leased_until = None
                event.leased_by = ""
            for entity_ref in revision.metadata.get("entity_refs", []):
                link_key = (
                    revision.knowledge_base_id,
                    revision.document_revision_id,
                    entity_ref,
                )
                if await session.get(DocumentEntityLinkRow, link_key) is None:
                    session.add(
                        DocumentEntityLinkRow(
                            knowledge_base_id=revision.knowledge_base_id,
                            document_revision_id=revision.document_revision_id,
                            entity_ref=entity_ref,
                            source="ingestion",
                            created_at=now,
                        )
                    )
            await session.commit()

    async def get_enrichment_cache(self, cache_key: str) -> dict[str, Any] | None:
        async with self.session_factory() as session:
            row = await session.get(EnrichmentCacheRow, cache_key)
            if row is None:
                return None
            row.last_used_at = datetime.now(UTC)
            await session.commit()
            return row.result_json

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
    ) -> None:
        now = datetime.now(UTC)
        async with self.session_factory() as session:
            row = await session.get(EnrichmentCacheRow, cache_key)
            if row is None:
                row = EnrichmentCacheRow(
                    cache_key=cache_key,
                    content_sha256=content_sha256,
                    chat_model=chat_model,
                    prompt_version=prompt_version,
                    language=language,
                    keyword_top_n=keyword_top_n,
                    question_top_n=question_top_n,
                    result_json=result,
                    created_at=now,
                    last_used_at=now,
                )
                session.add(row)
            else:
                row.result_json = result
                row.last_used_at = now
            await session.commit()

    async def list_entity_aliases(self, knowledge_base_id: str) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            result = await session.execute(
                select(EntityAliasRow, EntityRow)
                .join(
                    EntityRow,
                    and_(
                        EntityRow.entity_ref == EntityAliasRow.entity_ref,
                        EntityRow.knowledge_base_id == EntityAliasRow.knowledge_base_id,
                    ),
                )
                .where(EntityAliasRow.knowledge_base_id == knowledge_base_id)
            )
            return [
                {
                    "alias": alias.alias,
                    "entity_ref": alias.entity_ref,
                    "entity_type": entity.entity_type,
                    "canonical_name": entity.canonical_name,
                }
                for alias, entity in result.all()
            ]

    async def upsert_entity(
        self,
        *,
        knowledge_base_id: str,
        entity_type: str,
        canonical_name: str,
        aliases: list[str],
        entity_ref: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        entity_ref = entity_ref or _entity_ref(entity_type, canonical_name)
        now = datetime.now(UTC)
        async with self.session_factory() as session:
            changed = False
            row = await session.get(EntityRow, (knowledge_base_id, entity_ref))
            if row is None:
                row = EntityRow(
                    entity_ref=entity_ref,
                    knowledge_base_id=knowledge_base_id,
                    entity_type=entity_type,
                    canonical_name=canonical_name,
                    metadata_json=metadata or {},
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                changed = True
            else:
                changed = row.canonical_name != canonical_name or (
                    metadata is not None and row.metadata_json != metadata
                )
                row.canonical_name = canonical_name
                row.metadata_json = metadata or row.metadata_json
                row.updated_at = now
            for alias in aliases or [canonical_name]:
                normalized = _normalize_alias(alias)
                alias_id = hashlib.sha256(
                    f"{knowledge_base_id}\x1f{entity_ref}\x1f{normalized}".encode()
                ).hexdigest()
                if await session.get(EntityAliasRow, alias_id) is None:
                    session.add(
                        EntityAliasRow(
                            alias_id=alias_id,
                            knowledge_base_id=knowledge_base_id,
                            entity_ref=entity_ref,
                            alias=alias,
                            normalized_alias=normalized,
                            created_at=now,
                        )
                    )
                    changed = True
            if changed:
                await self._enqueue_kb_reprojection(
                    session,
                    knowledge_base_id=knowledge_base_id,
                    reason=f"entity:{entity_ref}",
                    now=now,
                )
            await session.commit()
        return entity_ref

    async def link_document_entities(
        self,
        *,
        knowledge_base_id: str,
        revision_id: str,
        entity_refs: list[str],
        source: str = "alias_match",
    ) -> None:
        async with self.session_factory() as session:
            await session.execute(
                delete(DocumentEntityLinkRow).where(
                    DocumentEntityLinkRow.knowledge_base_id == knowledge_base_id,
                    DocumentEntityLinkRow.document_revision_id == revision_id,
                )
            )
            now = datetime.now(UTC)
            for entity_ref in dict.fromkeys(entity_refs):
                session.add(
                    DocumentEntityLinkRow(
                        knowledge_base_id=knowledge_base_id,
                        document_revision_id=revision_id,
                        entity_ref=entity_ref,
                        source=source,
                        created_at=now,
                    )
                )
            await session.commit()

    async def _enqueue_kb_reprojection(
        self,
        session,
        *,
        knowledge_base_id: str,
        reason: str,
        now: datetime,
    ) -> None:
        result = await session.execute(
            select(DocumentRevisionRow).where(
                DocumentRevisionRow.knowledge_base_id == knowledge_base_id,
                DocumentRevisionRow.status.in_(["COMPLETED", "INDEXED"]),
            )
        )
        for revision in result.scalars():
            event_id = (
                f"reprojection:{revision.document_revision_id}:"
                f"{int(now.timestamp() * 1_000_000)}"
            )
            session.add(
                OutboxEventRow(
                    event_id=event_id,
                    event_type="chunk_projection.rebuild",
                    aggregate_id=revision.document_revision_id,
                    payload_json={
                        "revision_id": revision.document_revision_id,
                        "knowledge_base_id": knowledge_base_id,
                        "artifact_object_key": revision.artifact_object_key,
                        "artifact_checksum": revision.artifact_checksum,
                        "chunk_count": revision.chunk_count,
                        "reason": reason,
                    },
                    status="pending",
                    available_at=now,
                    created_at=now,
                )
            )

    async def claim_outbox(
        self, *, worker_id: str, lease_seconds: int = 60
    ) -> OutboxEvent | None:
        now = datetime.now(UTC)
        async with self.session_factory() as session:
            result = await session.execute(
                select(OutboxEventRow)
                .where(
                    OutboxEventRow.available_at <= now,
                    or_(
                        OutboxEventRow.status == "pending",
                        and_(
                            OutboxEventRow.status == "processing",
                            OutboxEventRow.leased_until < now,
                        ),
                    ),
                )
                .order_by(OutboxEventRow.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            row = result.scalars().first()
            if row is None:
                await session.rollback()
                return None
            row.status = "processing"
            row.leased_by = worker_id
            row.leased_until = now + timedelta(seconds=lease_seconds)
            row.attempts += 1
            await session.commit()
            return OutboxEvent(
                event_id=row.event_id,
                event_type=row.event_type,
                aggregate_id=row.aggregate_id,
                payload=dict(row.payload_json),
                attempts=row.attempts,
            )

    async def ack_outbox(self, event_id: str) -> None:
        async with self.session_factory() as session:
            row = await session.get(OutboxEventRow, event_id)
            if row:
                row.status = "done"
                row.leased_until = None
                row.leased_by = ""
                await session.commit()

    async def activate_projection(self, revision_id: str) -> ProjectionActivation:
        async with self.session_factory() as session:
            revision = await session.get(DocumentRevisionRow, revision_id)
            if revision is None:
                raise ValueError(f"unknown projection revision {revision_id!r}")
            document = await session.get(
                DocumentRow,
                revision.document_id,
                with_for_update=True,
            )
            if document is None:
                raise ValueError(
                    f"unknown projection document {revision.document_id!r}"
                )

            current = None
            if document.current_revision_id:
                current = await session.get(
                    DocumentRevisionRow, document.current_revision_id
                )
            if current is not None and _revision_order(revision) < _revision_order(
                current
            ):
                revision.status = "SUPERSEDED"
                await session.commit()
                return ProjectionActivation(active=False)

            result = await session.execute(
                select(DocumentRevisionRow)
                .where(DocumentRevisionRow.document_id == revision.document_id)
                .with_for_update()
            )
            superseded = tuple(
                sorted(
                    row.document_revision_id
                    for row in result.scalars()
                    if row.document_revision_id != revision_id
                    and _revision_order(row) < _revision_order(revision)
                )
            )
            if superseded:
                await session.execute(
                    update(DocumentRevisionRow)
                    .where(DocumentRevisionRow.document_revision_id.in_(superseded))
                    .values(status="SUPERSEDED")
                )
            revision.status = JobStatus.COMPLETED.value
            document.current_revision_id = revision_id
            document.title = revision.title
            document.source_name = revision.source_name
            document.metadata_json = revision.metadata_json
            document.updated_at = datetime.now(UTC)
            await session.commit()
            return ProjectionActivation(
                active=True,
                superseded_revision_ids=superseded,
            )

    async def complete_projection(self, event_id: str, revision_id: str) -> None:
        async with self.session_factory() as session:
            event = await session.get(OutboxEventRow, event_id)
            result = await session.execute(
                select(IngestionJobRow).where(
                    IngestionJobRow.document_revision_id == revision_id
                )
            )
            job = result.scalars().first()
            if job:
                job.status = JobStatus.COMPLETED.value
                job.updated_at = datetime.now(UTC)
            if event:
                event.status = "done"
                event.leased_until = None
                event.leased_by = ""
            await session.commit()

    async def fail_outbox(
        self, event_id: str, error: str, *, retry: bool = True
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(OutboxEventRow, event_id)
            if row:
                row.status = "pending" if retry else "failed"
                row.last_error = error[:1000]
                row.available_at = datetime.now(UTC) + timedelta(
                    seconds=min(300, 2 ** min(row.attempts, 8))
                )
                row.leased_until = None
                await session.commit()

    async def mark_projection_completed(self, revision_id: str) -> None:
        async with self.session_factory() as session:
            revision = await session.get(DocumentRevisionRow, revision_id)
            if revision:
                revision.status = JobStatus.COMPLETED.value
            result = await session.execute(
                select(IngestionJobRow).where(
                    IngestionJobRow.document_revision_id == revision_id
                )
            )
            job = result.scalars().first()
            if job:
                job.status = JobStatus.COMPLETED.value
                job.updated_at = datetime.now(UTC)
            await session.commit()

    async def mark_projection_indexed(self, revision_id: str) -> None:
        async with self.session_factory() as session:
            await session.execute(
                update(DocumentRevisionRow)
                .where(
                    DocumentRevisionRow.document_revision_id == revision_id,
                    DocumentRevisionRow.status.notin_(
                        ["SUPERSEDED", JobStatus.COMPLETED.value]
                    ),
                )
                .values(status=JobStatus.INDEXED.value)
            )
            result = await session.execute(
                select(IngestionJobRow).where(
                    IngestionJobRow.document_revision_id == revision_id
                )
            )
            job = result.scalars().first()
            if job:
                job.status = JobStatus.INDEXED.value
                job.updated_at = datetime.now(UTC)
            await session.commit()

    async def mark_projection_failed(self, revision_id: str, error: str) -> None:
        async with self.session_factory() as session:
            revision = await session.get(DocumentRevisionRow, revision_id)
            if revision:
                revision.status = JobStatus.FAILED.value
            result = await session.execute(
                select(IngestionJobRow).where(
                    IngestionJobRow.document_revision_id == revision_id
                )
            )
            job = result.scalars().first()
            if job:
                job.status = JobStatus.FAILED.value
                job.last_error_code = "index_error"
                job.last_error_message = error[:1000]
                job.updated_at = datetime.now(UTC)
            await session.commit()

    async def list_projection_revisions(
        self, knowledge_base_id: str | None = None
    ) -> list[dict[str, Any]]:
        async with self.session_factory() as session:
            statement = select(DocumentRevisionRow).join(
                DocumentRow,
                DocumentRow.current_revision_id
                == DocumentRevisionRow.document_revision_id,
            )
            if knowledge_base_id is not None:
                statement = statement.where(
                    DocumentRevisionRow.knowledge_base_id == knowledge_base_id
                )
            result = await session.execute(statement)
            return [
                {
                    "revision_id": row.document_revision_id,
                    "knowledge_base_id": row.knowledge_base_id,
                    "artifact_object_key": row.artifact_object_key,
                    "artifact_checksum": row.artifact_checksum,
                    "chunk_count": row.chunk_count,
                }
                for row in result.scalars()
            ]

    async def list_documents(
        self, knowledge_base_id: str, limit: int, cursor: str | None
    ) -> tuple[list[dict[str, Any]], str | None]:
        async with self.session_factory() as session:
            statement = (
                select(DocumentRow)
                .join(
                    DocumentRevisionRow,
                    DocumentRevisionRow.document_revision_id
                    == DocumentRow.current_revision_id,
                )
                .where(DocumentRow.knowledge_base_id == knowledge_base_id)
                .where(DocumentRevisionRow.status == JobStatus.COMPLETED.value)
                .order_by(DocumentRow.updated_at.desc(), DocumentRow.document_id)
                .limit(limit + 1)
            )
            if cursor is not None:
                cursor_time, cursor_id = _decode_document_cursor(cursor)
                statement = statement.where(
                    or_(
                        DocumentRow.updated_at < cursor_time,
                        and_(
                            DocumentRow.updated_at == cursor_time,
                            DocumentRow.document_id > cursor_id,
                        ),
                    )
                )
            result = await session.execute(statement)
            rows = list(result.scalars())
            next_cursor = None
            if len(rows) > limit:
                rows = rows[:limit]
                next_cursor = _encode_document_cursor(
                    rows[-1].updated_at, rows[-1].document_id
                )
            return [
                {
                    "document_id": row.document_id,
                    "knowledge_base_id": row.knowledge_base_id,
                    "revision_id": row.current_revision_id,
                    "title": row.title,
                    "source_name": row.source_name,
                    "metadata": row.metadata_json,
                    "updated_at": row.updated_at.isoformat(),
                }
                for row in rows
            ], next_cursor

    async def assert_migration_head(self, expected_head: str) -> None:
        from sqlalchemy import text

        async with self.session_factory() as session:
            value = await session.scalar(
                text("SELECT version_num FROM alembic_version LIMIT 1")
            )
            if value != expected_head:
                raise RuntimeError(
                    f"database migration head {value!r} does not match {expected_head!r}"
                )


def _copy_job(row: IngestionJobRow, job: IngestionJob) -> None:
    values = asdict(job)
    values["status"] = job.status.value
    values["enrichment_status"] = job.enrichment_status.value
    for key, value in values.items():
        if hasattr(row, key):
            setattr(row, key, value)


def _revision_from_row(row: DocumentRevisionRow) -> DocumentRevision:
    blocks = tuple(
        DocumentBlock(**_decode_block(value)) for value in (row.blocks_json or [])
    )
    return DocumentRevision(
        document_id=row.document_id,
        document_revision_id=row.document_revision_id,
        knowledge_base_id=row.knowledge_base_id,
        source_sha256=row.source_sha256,
        source_object_key=row.source_object_key,
        source_name=row.source_name,
        title=row.title,
        parser_provider=row.parser_provider,
        parser_version=row.parser_version,
        blocks=blocks,
        revision_fingerprint=row.revision_fingerprint,
        enrichment_profile_id=row.enrichment_profile_id,
        metadata=row.metadata_json or {},
        created_at=row.created_at,
    )


def _revision_order(row: DocumentRevisionRow) -> tuple[datetime, str]:
    created_at = row.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return created_at, row.document_revision_id


def _decode_block(value: dict[str, Any]) -> dict[str, Any]:
    data = dict(value)
    for key in ("section_path", "asset_refs"):
        data[key] = tuple(data.get(key) or ())
    data["bounding_boxes"] = tuple(
        tuple(item) for item in data.get("bounding_boxes") or ()
    )
    return data


def _entity_ref(entity_type: str, canonical_name: str) -> str:
    slug = "-".join(
        "".join(
            character.lower() if character.isalnum() else "-"
            for character in canonical_name
        ).split("-")
    )
    return f"{entity_type}:{slug or 'unnamed'}"


def _normalize_alias(value: str) -> str:
    return " ".join(value.casefold().strip().split())


def _encode_document_cursor(updated_at: datetime, document_id: str) -> str:
    data = json.dumps([updated_at.isoformat(), document_id], separators=(",", ":"))
    return base64.urlsafe_b64encode(data.encode()).decode().rstrip("=")


def _decode_document_cursor(value: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(value) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(value + padding))
        if (
            not isinstance(decoded, list)
            or len(decoded) != 2
            or not all(isinstance(item, str) for item in decoded)
        ):
            raise ValueError
        return datetime.fromisoformat(decoded[0]), decoded[1]
    except (
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        binascii.Error,
    ) as exc:
        raise ValueError("invalid document cursor") from exc
