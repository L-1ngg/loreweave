from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


class JobStatus(StrEnum):
    RECEIVED = "RECEIVED"
    STORED_RAW = "STORED_RAW"
    PARSE_SUBMITTED = "PARSE_SUBMITTED"
    PARSE_RUNNING = "PARSE_RUNNING"
    PARSE_SUCCEEDED = "PARSE_SUCCEEDED"
    PARSE_FAILED = "PARSE_FAILED"
    NORMALIZED = "NORMALIZED"
    CHUNKED = "CHUNKED"
    ENRICHING = "ENRICHING"
    ENRICHED = "ENRICHED"
    EMBEDDED = "EMBEDDED"
    PROJECTION_PENDING = "PROJECTION_PENDING"
    INDEXED = "INDEXED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ParserTaskState(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class EnrichmentStatus(StrEnum):
    SKIPPED = "skipped"
    MANUAL = "manual"
    CACHED = "cached"
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"


@dataclass(frozen=True)
class EnrichmentProvenance:
    status: EnrichmentStatus = EnrichmentStatus.SKIPPED
    model: str = ""
    prompt_version: str = ""
    cache_key: str = ""
    language: str = ""
    keyword_top_n: int = 0
    question_top_n: int = 0
    generated_keywords: bool = False
    generated_questions: bool = False
    error_summary: str = ""


@dataclass(frozen=True)
class DocumentBlock:
    block_id: str
    type: str
    text: str
    markdown: str = ""
    page_start: int | None = None
    page_end: int | None = None
    section_path: tuple[str, ...] = ()
    bounding_boxes: tuple[tuple[float, float, float, float], ...] = ()
    asset_refs: tuple[str, ...] = ()
    reading_order: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DocumentRevision:
    document_id: str
    document_revision_id: str
    knowledge_base_id: str
    source_sha256: str
    source_object_key: str
    source_name: str
    title: str
    parser_provider: str
    parser_version: str
    blocks: tuple[DocumentBlock, ...]
    revision_fingerprint: str = ""
    enrichment_profile_id: str = "disabled"
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    document_revision_id: str
    knowledge_base_id: str
    title: str
    content: str
    section_path: tuple[str, ...]
    page_start: int | None
    page_end: int | None
    block_ids: tuple[str, ...]
    asset_refs: tuple[str, ...]
    source_object_key: str
    embedding_profile_id: str
    chunking_version: str
    important_kwd: tuple[str, ...] = ()
    important_tks: str = ""
    question_kwd: tuple[str, ...] = ()
    question_tks: str = ""
    title_tks: str = ""
    title_sm_tks: str = ""
    content_ltks: str = ""
    content_sm_ltks: str = ""
    content_with_weight: str = ""
    enrichment: EnrichmentProvenance = field(default_factory=EnrichmentProvenance)
    source_type: str = ""
    language: str = ""
    tags: tuple[str, ...] = ()
    source_date: datetime | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    entity_refs: tuple[str, ...] = ()
    content_vector: tuple[float, ...] = ()
    checksum: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True)
class RemoteParseTask:
    task_id: str
    state: ParserTaskState
    result_url: str = ""
    error_code: str = ""
    error_message: str = ""
    progress: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ParseArtifact:
    task_id: str
    archive: bytes
    provider: str = "mineru"
    parser_version: str = "remote"


@dataclass
class IngestionJob:
    job_id: str
    document_id: str
    document_revision_id: str
    knowledge_base_id: str
    source_sha256: str
    source_name: str
    source_object_key: str
    status: JobStatus = JobStatus.RECEIVED
    parse_provider: str = "mineru"
    parse_task_id: str = ""
    parse_result_object_key: str = ""
    embedding_profile_id: str = ""
    enrichment_profile_id: str = "disabled"
    revision_fingerprint: str = ""
    chunking_version: str = ""
    embedded_chunks_object_key: str = ""
    embedded_chunks_checksum: str = ""
    enrichment_status: EnrichmentStatus = EnrichmentStatus.SKIPPED
    enrichment_failed_chunks: int = 0
    enrichment_error_summary: str = ""
    retry_count: int = 0
    last_error_code: str = ""
    last_error_message: str = ""
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def transition(self, status: JobStatus) -> None:
        self.status = status
        self.updated_at = utc_now()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RankedChunk:
    chunk: Chunk
    rank: int
    score: float


@dataclass(frozen=True)
class QueryReplacement:
    original: str
    replacement: str
    kind: str


@dataclass(frozen=True)
class QueryContext:
    user_query: str
    resolved_query: str = ""
    entity_refs: tuple[str, ...] = ()
    time_expressions: tuple[str, ...] = ()
    selected_document_id: str = ""


@dataclass(frozen=True)
class QueryPlan:
    normalization_version: str
    raw_query: str
    resolved_query: str
    lexical_query: str
    semantic_query: str
    filters: dict[str, Any] = field(default_factory=dict)
    replacements: tuple[QueryReplacement, ...] = ()
    ambiguities: tuple[str, ...] = ()


@dataclass(frozen=True)
class Evidence:
    rank: int
    chunk_id: str
    document_id: str
    document_revision_id: str
    title: str
    snippet: str
    page_start: int | None
    page_end: int | None
    section_path: tuple[str, ...]
    source_uri: str
    score: float
    term_score: float
    vector_score: float
    asset_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class SearchEvidenceResult:
    status: str
    resolved_query: str
    query_plan: QueryPlan
    knowledge_base_id: str
    results: tuple[Evidence, ...]
    next_context: QueryContext
    total_candidates: int = 0
    truncated: bool = False
    degraded: bool = False


@dataclass(frozen=True)
class AnswerCitation:
    marker: int
    rank: int
    chunk_id: str
    document_id: str
    document_revision_id: str
    title: str
    snippet: str
    page_start: int | None
    page_end: int | None
    section_path: tuple[str, ...]
    source_uri: str
    score: float
    term_score: float
    vector_score: float
    asset_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class GenerationMetadata:
    model: str
    prompt_version: str


@dataclass(frozen=True)
class AnswerResult:
    status: str
    answer: str | None
    citations: tuple[AnswerCitation, ...]
    retrieval: SearchEvidenceResult
    generation: GenerationMetadata


@dataclass(frozen=True)
class IngestionResult:
    job_id: str
    document_id: str
    document_revision_id: str
    status: JobStatus
    chunk_count: int
    enrichment_status: EnrichmentStatus = EnrichmentStatus.SKIPPED
    enrichment_failed_chunks: int = 0
