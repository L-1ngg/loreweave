from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Iterable
from dataclasses import asdict, replace
from datetime import datetime
from hashlib import sha256
import json
import mimetypes
from pathlib import Path
import re
import time
from typing import TypeVar

from ..domain.models import (
    Chunk,
    DocumentRevision,
    DocumentBlock,
    EnrichmentStatus,
    IngestionJob,
    IngestionResult,
    JobStatus,
    ParserTaskState,
)
from ..domain.ports import (
    BusinessRepository,
    ChatProvider,
    EmbeddingProvider,
    ObjectStore,
    RemoteParser,
)
from ..domain.query_understanding import EntityAliasMatcher
from ..infrastructure.config import Settings
from ..processing.artifacts import build_embedded_artifact, chunks_checksum
from ..processing.chunking import (
    CHUNKING_VERSION,
    chunk_document,
    retrieval_text_for_chunk,
)
from ..processing.embedding import embed_enriched_chunks
from ..processing.enrichment import (
    EnrichmentOptions,
    EnrichmentService,
    detect_language,
)
from ..processing.normalization import (
    NormalizedMinerUArchive,
    derive_title,
    load_mineru_archive,
    resolve_archive_file,
)


class IngestionError(RuntimeError):
    """Raised when a document cannot complete the ingestion pipeline."""

    def __init__(self, message: str, *, code: str = "ingestion_error") -> None:
        super().__init__(message)
        self.code = code


_T = TypeVar("_T")


async def _run_stage(operation: Awaitable[_T], *, code: str, message: str) -> _T:
    try:
        return await operation
    except IngestionError:
        raise
    except Exception as exc:
        raise IngestionError(message, code=code) from exc


class IngestionService:
    def __init__(
        self,
        settings: Settings,
        *,
        repository: BusinessRepository,
        object_store: ObjectStore,
        parser: RemoteParser,
        embedding_provider: EmbeddingProvider,
        chat_provider: ChatProvider | None = None,
        sleep=asyncio.sleep,
        monotonic=time.monotonic,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._object_store = object_store
        self._parser = parser
        self._embedding_provider = embedding_provider
        self._sleep = sleep
        self._monotonic = monotonic
        self._enrichment = EnrichmentService(
            EnrichmentOptions(
                enabled=settings.indexing.enrichment.enabled,
                keyword_top_n=settings.indexing.enrichment.keyword_top_n,
                question_top_n=settings.indexing.enrichment.question_top_n,
                prompt_version=settings.indexing.enrichment.prompt_version,
                profile_id=settings.enrichment_profile_id,
            ),
            chat_provider=chat_provider,
            cache=repository,
        )

    async def ingest_file(
        self,
        path: str | Path,
        *,
        knowledge_base_id: str = "default",
        document_name: str | None = None,
        metadata: dict[str, object] | None = None,
        keywords: Iterable[str] = (),
        questions: Iterable[str] = (),
        enrich: bool | None = None,
    ) -> IngestionResult:
        source_path = Path(path)
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        content = await asyncio.to_thread(source_path.read_bytes)
        return await self.ingest_bytes(
            content,
            source_name=document_name or source_path.name,
            knowledge_base_id=knowledge_base_id,
            metadata=metadata,
            keywords=keywords,
            questions=questions,
            enrich=enrich,
        )

    async def ingest_bytes(
        self,
        content: bytes,
        *,
        source_name: str,
        knowledge_base_id: str = "default",
        metadata: dict[str, object] | None = None,
        keywords: Iterable[str] = (),
        questions: Iterable[str] = (),
        enrich: bool | None = None,
    ) -> IngestionResult:
        if not content:
            raise ValueError("source document is empty")
        if not source_name.strip():
            raise ValueError("source_name is required")
        if not _KNOWLEDGE_BASE_ID.fullmatch(knowledge_base_id):
            raise ValueError("knowledge_base_id must be 1 to 128 URL-safe characters")

        safe_name = _safe_name(source_name)
        if Path(safe_name).suffix.lower() not in _SUPPORTED_SUFFIXES:
            raise IngestionError(
                f"unsupported document type {Path(safe_name).suffix or '<none>'!r}",
                code="unsupported_document",
            )
        source_hash = sha256(content).hexdigest()
        metadata = dict(metadata or {})
        manual_keywords = tuple(keywords)
        manual_questions = tuple(questions)
        enrichment_enabled = (
            self._settings.indexing.enrichment.enabled if enrich is None else enrich
        )
        fingerprint = _revision_fingerprint(
            source_hash=source_hash,
            chunking_version=CHUNKING_VERSION,
            chunk_max_tokens=self._settings.indexing.chunking.max_tokens,
            chunk_overlap_tokens=self._settings.indexing.chunking.overlap_tokens,
            embedding_profile_id=self._embedding_provider.profile_id,
            enrichment_profile_id=(
                self._settings.enrichment_profile_id
                if enrichment_enabled
                else "disabled"
            ),
            keywords=manual_keywords,
            questions=manual_questions,
            metadata=metadata,
        )
        document_id = _document_id(knowledge_base_id, safe_name)
        revision_id = _revision_id(document_id, source_hash, fingerprint)
        existing = await self._repository.find_completed_revision(
            knowledge_base_id, document_id, source_hash, fingerprint
        )
        if existing is not None:
            # A completed revision is immutable and can be safely reused.
            return IngestionResult(
                job_id=revision_id,
                document_id=document_id,
                document_revision_id=revision_id,
                status=JobStatus.COMPLETED,
                chunk_count=0,
                enrichment_status=EnrichmentStatus.SKIPPED,
            )

        raw_key = _artifact_key(
            knowledge_base_id, document_id, revision_id, "raw/source"
        )
        parsed_key = _artifact_key(
            knowledge_base_id, document_id, revision_id, "parsed/result.zip"
        )
        derived_key = _artifact_key(
            knowledge_base_id, document_id, revision_id, "derived/document.json"
        )
        chunks_key = _artifact_key(
            knowledge_base_id, document_id, revision_id, "derived/chunks.json"
        )
        embedded_chunks_key = _artifact_key(
            knowledge_base_id, document_id, revision_id, "derived/chunks.embedded.json"
        )
        job = IngestionJob(
            job_id=revision_id,
            document_id=document_id,
            document_revision_id=revision_id,
            knowledge_base_id=knowledge_base_id,
            source_sha256=source_hash,
            source_name=safe_name,
            source_object_key=raw_key,
            embedding_profile_id=self._embedding_provider.profile_id,
            enrichment_profile_id=(
                self._settings.enrichment_profile_id
                if enrichment_enabled
                else "disabled"
            ),
            revision_fingerprint=fingerprint,
            chunking_version=CHUNKING_VERSION,
            enrichment_status=(
                EnrichmentStatus.SUCCEEDED
                if enrichment_enabled
                else EnrichmentStatus.SKIPPED
            ),
        )
        await self._repository.save_job(job)

        try:
            await _run_stage(
                self._object_store.put_bytes(
                    raw_key,
                    content,
                    content_type=_content_type(safe_name),
                    metadata={
                        "sha256": source_hash,
                        "document-revision-id": revision_id,
                    },
                ),
                code="source_store_error",
                message="failed to store source document",
            )
            job.transition(JobStatus.STORED_RAW)
            await self._repository.save_job(job)

            source_url = await _run_stage(
                self._object_store.presign_get(
                    raw_key, self._settings.storage.s3_presign_expiry_seconds
                ),
                code="source_store_error",
                message="failed to create source download URL",
            )
            task = await _run_stage(
                self._parser.submit(source_url, safe_name, revision_id),
                code="parser_submit_error",
                message="failed to submit document to MinerU",
            )
            job.parse_task_id = task.task_id
            job.transition(JobStatus.PARSE_SUBMITTED)
            await self._repository.save_job(job)

            completed_task = await self._wait_for_parse(task.task_id, job)
            artifact = await _run_stage(
                self._parser.download_result(completed_task),
                code="parser_result_error",
                message="failed to download MinerU result",
            )
            await _run_stage(
                self._object_store.put_bytes(
                    parsed_key,
                    artifact.archive,
                    content_type="application/zip",
                    metadata={"remote-task-id": artifact.task_id},
                ),
                code="source_store_error",
                message="failed to store MinerU result",
            )
            job.parse_result_object_key = parsed_key
            job.transition(JobStatus.PARSE_SUCCEEDED)
            await self._repository.save_job(job)

            try:
                normalized = load_mineru_archive(
                    artifact.archive, max_bytes=self._settings.parser.max_result_bytes
                )
            except Exception as exc:
                raise IngestionError(
                    "failed to normalize MinerU result", code="normalization_error"
                ) from exc
            blocks = normalized.blocks
            if not blocks:
                raise IngestionError(
                    "MinerU returned no searchable blocks", code="normalization_error"
                )
            (
                blocks,
                asset_object_keys,
                parsed_object_keys,
            ) = await _run_stage(
                self._store_parsed_assets(
                    normalized,
                    knowledge_base_id=knowledge_base_id,
                    document_id=document_id,
                    revision_id=revision_id,
                ),
                code="source_store_error",
                message="failed to store normalized MinerU artifacts",
            )
            revision = DocumentRevision(
                document_id=document_id,
                document_revision_id=revision_id,
                knowledge_base_id=knowledge_base_id,
                source_sha256=source_hash,
                source_object_key=raw_key,
                source_name=safe_name,
                title=derive_title(blocks, Path(safe_name).stem or "untitled"),
                parser_provider="mineru",
                parser_version=str(artifact.parser_version or "remote"),
                blocks=blocks,
                revision_fingerprint=fingerprint,
                enrichment_profile_id=job.enrichment_profile_id,
                metadata={
                    "parsed_object_key": parsed_key,
                    "parsed_artifact_keys": parsed_object_keys,
                    "asset_object_keys": asset_object_keys,
                    **metadata,
                },
            )
            await _run_stage(
                self._object_store.put_bytes(
                    derived_key,
                    _json_bytes(asdict(revision)),
                    content_type="application/json",
                    metadata={"document-revision-id": revision_id},
                ),
                code="source_store_error",
                message="failed to store normalized document",
            )
            job.transition(JobStatus.NORMALIZED)
            await self._repository.save_job(job)

            try:
                chunks = list(
                    chunk_document(
                        revision,
                        embedding_profile_id=self._embedding_provider.profile_id,
                        chunking_version=job.chunking_version,
                        max_tokens=self._settings.indexing.chunking.max_tokens,
                        overlap_tokens=self._settings.indexing.chunking.overlap_tokens,
                    )
                )
            except Exception as exc:
                raise IngestionError(
                    "failed to chunk normalized document", code="chunking_error"
                ) from exc
            if not chunks:
                raise IngestionError(
                    "normalization produced no chunks", code="chunking_error"
                )
            await _run_stage(
                self._object_store.put_bytes(
                    chunks_key,
                    _json_bytes([asdict(chunk) for chunk in chunks]),
                    content_type="application/json",
                    metadata={"document-revision-id": revision_id},
                ),
                code="source_store_error",
                message="failed to store chunks",
            )
            job.transition(JobStatus.CHUNKED)
            await self._repository.save_job(job)

            job.transition(JobStatus.ENRICHING)
            await self._repository.save_job(job)
            language = str(
                metadata.get("language")
                or detect_language(" ".join(block.text for block in blocks))
            )
            chunks = await self._link_chunk_entities(
                chunks, knowledge_base_id, metadata
            )
            enriched_pairs = await asyncio.gather(
                *(
                    self._enrichment.enrich_chunk(
                        _apply_chunk_metadata(chunk, revision, metadata),
                        language=language,
                        manual_keywords=manual_keywords,
                        manual_questions=manual_questions,
                        enabled=enrichment_enabled,
                    )
                    for chunk in chunks
                )
            )
            enriched_chunks = [pair[0] for pair in enriched_pairs]
            failed_count = sum(
                pair[1].provenance.status
                in {EnrichmentStatus.FAILED, EnrichmentStatus.PARTIAL}
                for pair in enriched_pairs
            )
            errors = [
                pair[1].provenance.error_summary
                for pair in enriched_pairs
                if pair[1].provenance.error_summary
            ]
            job.enrichment_failed_chunks = failed_count
            job.enrichment_error_summary = "; ".join(_unique(errors))[:1000]
            statuses = {pair[1].provenance.status for pair in enriched_pairs}
            if failed_count:
                job.enrichment_status = EnrichmentStatus.PARTIAL
            elif EnrichmentStatus.CACHED in statuses:
                job.enrichment_status = EnrichmentStatus.CACHED
            elif EnrichmentStatus.MANUAL in statuses:
                job.enrichment_status = EnrichmentStatus.MANUAL
            elif enrichment_enabled:
                job.enrichment_status = EnrichmentStatus.SUCCEEDED
            else:
                job.enrichment_status = EnrichmentStatus.SKIPPED
            job.transition(JobStatus.ENRICHED)
            await self._repository.save_job(job)

            embedded_chunks = await _run_stage(
                embed_enriched_chunks(self._embedding_provider, enriched_chunks),
                code="embedding_error",
                message="failed to embed chunks",
            )
            embedded_chunks = [
                replace(
                    chunk,
                    checksum=_chunk_checksum(chunk),
                )
                for chunk in embedded_chunks
            ]
            artifact_bytes, artifact_checksum = build_embedded_artifact(
                revision_id=revision_id,
                revision_fingerprint=fingerprint,
                chunks=embedded_chunks,
            )
            await _run_stage(
                self._object_store.put_bytes(
                    embedded_chunks_key,
                    artifact_bytes,
                    content_type="application/json",
                    metadata={"document-revision-id": revision_id},
                ),
                code="source_store_error",
                message="failed to store embedded chunks",
            )
            job.transition(JobStatus.EMBEDDED)
            await self._repository.save_job(job)
            job.embedded_chunks_object_key = embedded_chunks_key
            job.embedded_chunks_checksum = artifact_checksum
            revision = replace(
                revision,
                metadata={
                    **revision.metadata,
                    "entity_refs": list(
                        _unique(
                            ref
                            for chunk in embedded_chunks
                            for ref in chunk.entity_refs
                        )
                    ),
                },
            )
            await _run_stage(
                self._repository.save_revision_projection(
                    revision,
                    chunk_count=len(embedded_chunks),
                    artifact_object_key=embedded_chunks_key,
                    artifact_checksum=artifact_checksum,
                    job=job,
                ),
                code="index_error",
                message="failed to persist revision projection metadata",
            )
            return IngestionResult(
                job_id=job.job_id,
                document_id=job.document_id,
                document_revision_id=job.document_revision_id,
                status=job.status,
                chunk_count=len(embedded_chunks),
                enrichment_status=job.enrichment_status,
                enrichment_failed_chunks=job.enrichment_failed_chunks,
            )
        except Exception as exc:
            if not isinstance(exc, IngestionError):
                code = "ingestion_error"
                message = str(exc)
            else:
                code = exc.code
                message = str(exc)
            job.last_error_code = code
            job.last_error_message = message[:1000]
            if job.status not in {JobStatus.PARSE_FAILED, JobStatus.COMPLETED}:
                job.transition(JobStatus.FAILED)
            await self._repository.save_job(job)
            if isinstance(exc, IngestionError):
                raise
            raise IngestionError(message, code=code) from exc

    async def _link_chunk_entities(
        self,
        chunks: list[Chunk],
        knowledge_base_id: str,
        metadata: dict[str, object],
    ) -> list[Chunk]:
        entities = metadata.get("entities") or []
        if entities and not isinstance(entities, list):
            raise ValueError("metadata.entities must be an array")
        for entity in entities:
            if not isinstance(entity, dict):
                raise ValueError("metadata.entities entries must be objects")
            entity_ref = entity.get("entity_ref")
            await self._repository.upsert_entity(
                knowledge_base_id=knowledge_base_id,
                entity_type=str(entity["type"]),
                canonical_name=str(entity["name"]),
                aliases=[str(item) for item in entity.get("aliases", [entity["name"]])],
                entity_ref=str(entity_ref) if entity_ref is not None else None,
                metadata=entity.get("metadata") or {},
            )
        records = await self._repository.list_entity_aliases(knowledge_base_id)
        matcher = EntityAliasMatcher(records)
        result: list[Chunk] = []
        for chunk in chunks:
            hits, _ = matcher.match(f"{chunk.title}\n{retrieval_text_for_chunk(chunk)}")
            refs = _unique([*chunk.entity_refs, *(hit.entity_ref for hit in hits)])
            result.append(replace(chunk, entity_refs=refs))
        return result

    async def _store_parsed_assets(
        self,
        normalized: NormalizedMinerUArchive,
        *,
        knowledge_base_id: str,
        document_id: str,
        revision_id: str,
    ) -> tuple[tuple[DocumentBlock, ...], tuple[str, ...], tuple[str, ...]]:
        """Persist referenced assets and rewrite block references to immutable keys."""

        asset_refs = _unique(
            ref for block in normalized.blocks for ref in block.asset_refs
        )
        asset_keys: dict[str, str] = {}
        for ref in asset_refs:
            resolved = resolve_archive_file(normalized.files, ref)
            if resolved is None:
                continue
            _, data = resolved
            key = _artifact_key(
                knowledge_base_id,
                document_id,
                revision_id,
                f"parsed/assets/{ref}",
            )
            await self._object_store.put_bytes(
                key,
                data,
                content_type=mimetypes.guess_type(ref)[0] or "application/octet-stream",
                metadata={"document-revision-id": revision_id},
            )
            asset_keys[ref] = key

        parsed_keys: list[str] = []
        for filename, content_type in (
            ("full.md", "text/markdown"),
            ("content_list_v2.json", "application/json"),
        ):
            resolved = resolve_archive_file(normalized.files, filename)
            if resolved is None:
                continue
            _, data = resolved
            key = _artifact_key(
                knowledge_base_id,
                document_id,
                revision_id,
                f"parsed/{filename}",
            )
            await self._object_store.put_bytes(
                key,
                data,
                content_type=content_type,
                metadata={"document-revision-id": revision_id},
            )
            parsed_keys.append(key)

        rewritten = tuple(
            replace(
                block,
                asset_refs=tuple(asset_keys.get(ref, ref) for ref in block.asset_refs),
                markdown=_rewrite_asset_markdown(block.markdown, asset_keys),
            )
            for block in normalized.blocks
        )
        return rewritten, tuple(asset_keys.values()), tuple(parsed_keys)

    async def _wait_for_parse(self, task_id: str, job: IngestionJob):
        deadline = self._monotonic() + self._settings.parser.max_wait_seconds
        while True:
            if self._monotonic() > deadline:
                job.last_error_code = "parser_timeout"
                job.last_error_message = f"MinerU task {task_id} exceeded wait deadline"
                job.transition(JobStatus.FAILED)
                await self._repository.save_job(job)
                raise IngestionError(job.last_error_message, code="parser_timeout")
            task = await _run_stage(
                self._parser.get_task(task_id),
                code="parser_result_error",
                message="failed to poll MinerU task",
            )
            if task.state is ParserTaskState.SUCCEEDED:
                return task
            if task.state is ParserTaskState.FAILED:
                job.last_error_code = task.error_code or "parser_failed"
                job.last_error_message = task.error_message or "MinerU task failed"
                job.transition(JobStatus.PARSE_FAILED)
                await self._repository.save_job(job)
                raise IngestionError(job.last_error_message, code="parser_failed")
            job.transition(JobStatus.PARSE_RUNNING)
            await self._repository.save_job(job)
            await self._sleep(self._settings.parser.poll_interval_seconds)


def _safe_name(name: str) -> str:
    value = Path(name).name.strip()
    value = re.sub(r"[^\w.()\[\] -]+", "_", value, flags=re.UNICODE)
    if not value or value in {".", ".."}:
        raise ValueError("source_name must include a valid file name")
    return value[:240]


def _document_id(knowledge_base_id: str, source_name: str) -> str:
    return (
        "doc_"
        + sha256(f"{knowledge_base_id}\x1f{source_name}".encode()).hexdigest()[:24]
    )


def _revision_id(document_id: str, source_hash: str, fingerprint: str = "") -> str:
    return (
        "rev_"
        + sha256(
            f"{document_id}\x1f{source_hash}\x1f{fingerprint}".encode()
        ).hexdigest()[:32]
    )


def _revision_fingerprint(
    *,
    source_hash: str,
    chunking_version: str,
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
    embedding_profile_id: str,
    enrichment_profile_id: str,
    keywords: tuple[str, ...],
    questions: tuple[str, ...],
    metadata: dict[str, object],
) -> str:
    payload = json.dumps(
        {
            "source_sha256": source_hash,
            "chunking_version": chunking_version,
            "chunk_max_tokens": chunk_max_tokens,
            "chunk_overlap_tokens": chunk_overlap_tokens,
            "embedding_profile_id": embedding_profile_id,
            "enrichment_profile_id": enrichment_profile_id,
            "keywords": keywords,
            "questions": questions,
            "metadata": metadata,
        },
        ensure_ascii=False,
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    )
    return sha256(payload.encode()).hexdigest()


def _apply_chunk_metadata(
    chunk: Chunk, revision: DocumentRevision, metadata: dict[str, object]
) -> Chunk:
    source_type = str(
        metadata.get("source_type")
        or Path(revision.source_name).suffix.lstrip(".").lower()
    )
    language = str(metadata.get("language") or detect_language(chunk.content))
    tags_value = metadata.get("tags") or ()
    if isinstance(tags_value, str):
        tags_value = [tags_value]
    entity_values = metadata.get("entity_refs") or ()
    if isinstance(entity_values, str):
        entity_values = [entity_values]
    return replace(
        chunk,
        source_type=source_type,
        language=language,
        tags=tuple(str(item) for item in tags_value),
        source_date=_metadata_datetime(metadata.get("source_date")),
        effective_from=_metadata_datetime(metadata.get("effective_from")),
        effective_to=_metadata_datetime(metadata.get("effective_to")),
        entity_refs=tuple(str(item) for item in entity_values),
    )


def _metadata_datetime(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"invalid metadata date {value!r}") from exc
    raise ValueError("metadata dates must be ISO-8601 strings")


def _chunk_checksum(chunk: Chunk) -> str:
    return chunks_checksum([replace(chunk, checksum="")])


def _artifact_key(
    knowledge_base_id: str, document_id: str, revision_id: str, suffix: str
) -> str:
    return f"knowledge-bases/{knowledge_base_id}/documents/{document_id}/revisions/{revision_id}/{suffix}"


def _json_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, default=_json_default, separators=(",", ":")
    ).encode("utf-8")


def _json_default(value: object) -> object:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _content_type(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".html": "text/html",
        ".htm": "text/html",
    }.get(suffix, "application/octet-stream")


def _rewrite_asset_markdown(markdown: str, asset_keys: dict[str, str]) -> str:
    rewritten = markdown
    for source, target in asset_keys.items():
        rewritten = rewritten.replace(f"]({source})", f"]({target})")
    return rewritten


def _unique(values: Iterable[str]) -> tuple[str, ...]:
    ordered: list[str] = []
    for value in values:
        if value not in ordered:
            ordered.append(value)
    return tuple(ordered)


_SUPPORTED_SUFFIXES = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
}

_KNOWLEDGE_BASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
