from __future__ import annotations

import io
from collections import deque
from dataclasses import dataclass, replace
from zipfile import ZipFile

import pytest

from rag_system.infrastructure.config import (
    ChunkingSettings,
    EmbeddingSettings,
    EnrichmentSettings,
    IndexingProfileSettings,
    ParserSettings,
    RetrievalProfileSettings,
    SecretValue,
    Settings,
    StorageSettings,
)
from rag_system.processing.artifacts import load_embedded_artifact
from rag_system.processing.chunking import CHUNKING_VERSION, retrieval_text_for_chunk
from rag_system.application.ingestion import IngestionError, IngestionService
from rag_system.domain.models import (
    DocumentRevision,
    EnrichmentStatus,
    IngestionJob,
    JobStatus,
    ParseArtifact,
    ParserTaskState,
    RemoteParseTask,
)


def _make_settings(*, max_wait_seconds: float = 2.0) -> Settings:
    return Settings(
        storage=StorageSettings(
            elasticsearch_url="http://es.example",
            elasticsearch_api_key=SecretValue("es-key"),
            s3_endpoint_url="http://s3.example",
            s3_bucket="my-rag",
            s3_access_key=SecretValue("access"),
            s3_secret_key=SecretValue("secret"),
        ),
        parser=ParserSettings(
            base_url="https://mineru.example",
            api_token=SecretValue("mineru-token"),
            poll_interval_seconds=0.0,
            max_wait_seconds=max_wait_seconds,
            max_result_bytes=1024 * 1024,
        ),
        embedding=EmbeddingSettings(
            base_url="https://embeddings.example",
            api_key=SecretValue("embedding-key"),
            model="text-embedding-3-small",
            dimensions=3,
            batch_size=2,
        ),
        indexing=IndexingProfileSettings(
            chunking=ChunkingSettings(max_tokens=64, overlap_tokens=8),
            enrichment=EnrichmentSettings(enabled=False),
        ),
        retrieval=RetrievalProfileSettings(
            top_k=5,
            candidate_k=10,
            num_candidates=20,
        ),
    )


def _archive_bytes() -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as zf:
        zf.writestr(
            "full.md",
            "# Title\n\nAlpha beta gamma.\n\n![Chart](images/chart.png)\n",
        )
        zf.writestr("images/chart.png", b"image-bytes")
    return buffer.getvalue()


@dataclass
class FakeObjectStore:
    put_calls: list[dict]
    presign_calls: list[tuple[str, int]]

    def __init__(self) -> None:
        self.put_calls = []
        self.presign_calls = []

    async def put_bytes(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> None:
        self.put_calls.append(
            {
                "key": key,
                "data": data,
                "content_type": content_type,
                "metadata": dict(metadata or {}),
            }
        )

    async def presign_get(self, key: str, expires_in: int) -> str:
        self.presign_calls.append((key, expires_in))
        return f"https://storage.example/{key}"


class FakeEmbeddingProvider:
    profile_id = "openai-compatible:text-embedding-3-small:3:cosine:v1"
    dimensions = 3

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [
            [float(index + 1), float(index + 2), float(index + 3)]
            for index, _ in enumerate(texts)
        ]


class FakeRepository:
    def __init__(self) -> None:
        self.saved_jobs: list[dict] = []
        self.indexed: list[tuple[DocumentRevision, tuple]] = []
        self.completed: dict[tuple[str, str, str, str], DocumentRevision] = {}

    async def save_job(self, job: IngestionJob) -> None:
        self.saved_jobs.append(job.to_dict())

    async def find_completed_revision(
        self,
        knowledge_base_id: str,
        document_id: str,
        source_sha256: str,
        revision_fingerprint: str,
    ) -> DocumentRevision | None:
        return self.completed.get(
            (knowledge_base_id, document_id, source_sha256, revision_fingerprint)
        )

    async def get_enrichment_cache(self, cache_key: str):
        return None

    async def put_enrichment_cache(self, cache_key: str, **kwargs) -> None:
        return None

    async def list_entity_aliases(self, knowledge_base_id: str):
        return []

    async def upsert_entity(self, **kwargs):
        return kwargs.get("entity_ref") or "test:entity"

    async def save_revision_projection(
        self,
        revision: DocumentRevision,
        *,
        chunk_count: int,
        artifact_object_key: str,
        artifact_checksum: str,
        job: IngestionJob,
    ) -> None:
        self.indexed.append(
            (revision, (chunk_count, artifact_object_key, artifact_checksum))
        )
        self.completed[
            (
                revision.knowledge_base_id,
                revision.document_id,
                revision.source_sha256,
                revision.revision_fingerprint,
            )
        ] = revision
        job.transition(JobStatus.PROJECTION_PENDING)
        await self.save_job(job)


class SuccessfulParser:
    def __init__(self) -> None:
        self.submit_calls: list[tuple[str, str, str]] = []
        self.polls = 0

    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        self.submit_calls.append((source_url, source_name, data_id))
        return RemoteParseTask(
            task_id="task-1",
            state=ParserTaskState.PENDING,
            progress={"remote_state": "pending"},
        )

    async def get_task(self, task_id: str) -> RemoteParseTask:
        self.polls += 1
        if self.polls == 1:
            return RemoteParseTask(
                task_id=task_id,
                state=ParserTaskState.RUNNING,
                progress={"remote_state": "running"},
            )
        return RemoteParseTask(
            task_id=task_id,
            state=ParserTaskState.SUCCEEDED,
            result_url="https://mineru.example/result.zip",
            progress={"remote_state": "succeeded"},
        )

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact:
        return ParseArtifact(task_id=task.task_id, archive=_archive_bytes())


class FailingParser:
    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        return RemoteParseTask(
            task_id="task-fail",
            state=ParserTaskState.PENDING,
            progress={"remote_state": "pending"},
        )

    async def get_task(self, task_id: str) -> RemoteParseTask:
        return RemoteParseTask(
            task_id=task_id,
            state=ParserTaskState.FAILED,
            error_code="remote_failed",
            error_message="MinerU rejected the file",
            progress={"remote_state": "failed"},
        )

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact:
        raise AssertionError(
            "download_result should not be called after a failed parse"
        )


class SubmitErrorParser:
    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        raise RuntimeError("provider connection failed")

    async def get_task(self, task_id: str) -> RemoteParseTask:
        raise AssertionError("get_task should not be called after submit failure")

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact:
        raise AssertionError(
            "download_result should not be called after submit failure"
        )


class EmbeddingErrorProvider(FakeEmbeddingProvider):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("embedding provider unavailable")


class EnrichmentChat:
    model_id = "chat-model"

    def __init__(self) -> None:
        self.calls = []

    async def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "keywords": ["alpha", "beta", "gamma", "delta", "epsilon"],
            "questions": ["What is alpha?", "What is beta?", "What is gamma?"],
        }


class RunningParser:
    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        return RemoteParseTask(
            task_id="task-timeout",
            state=ParserTaskState.PENDING,
            progress={"remote_state": "pending"},
        )

    async def get_task(self, task_id: str) -> RemoteParseTask:
        return RemoteParseTask(
            task_id=task_id,
            state=ParserTaskState.RUNNING,
            progress={"remote_state": "running"},
        )

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact:
        raise AssertionError(
            "download_result should not be called while the task is running"
        )


class MonotonicClock:
    def __init__(self, values: list[float]) -> None:
        self._values = deque(values)

    def __call__(self) -> float:
        if not self._values:
            raise AssertionError("monotonic called more times than expected")
        return self._values.popleft()


async def _no_sleep(_: float) -> None:
    return None


@pytest.mark.asyncio
async def test_fake_ingestion_pipeline_stores_artifacts_and_indexes_chunks() -> None:
    settings = _make_settings()
    repo = FakeRepository()
    store = FakeObjectStore()
    parser = SuccessfulParser()
    embedding = FakeEmbeddingProvider()
    service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
    )

    result = await service.ingest_bytes(
        b"sample bytes for ingestion",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )

    assert result.status is JobStatus.PROJECTION_PENDING
    assert result.chunk_count > 0
    assert parser.submit_calls[0][1:] == ("notes.pdf", result.document_revision_id)
    assert parser.submit_calls[0][0].endswith(store.put_calls[0]["key"])
    assert [
        call["key"].split(f"/{result.document_revision_id}/", 1)[1]
        for call in store.put_calls
    ] == [
        "raw/source",
        "parsed/result.zip",
        "parsed/assets/images/chart.png",
        "parsed/full.md",
        "derived/document.json",
        "derived/chunks.json",
        "derived/chunks.embedded.json",
    ]
    assert repo.saved_jobs[-1]["status"] is JobStatus.PROJECTION_PENDING
    assert repo.saved_jobs[-1]["chunking_version"] == CHUNKING_VERSION
    assert repo.indexed[0][0].document_revision_id == result.document_revision_id
    embedded_data = store.put_calls[-1]["data"]
    _, embedded_chunks = load_embedded_artifact(embedded_data)
    assert embedded_chunks[0].content_vector
    asset_refs = [ref for chunk in embedded_chunks for ref in chunk.asset_refs]
    assert len(asset_refs) == 1
    assert asset_refs[0].endswith("/parsed/assets/images/chart.png")
    assert asset_refs[0] in embedded_chunks[0].content
    assert embedding.calls == [
        ["Title"],
        [retrieval_text_for_chunk(embedded_chunks[0])],
    ]


@pytest.mark.asyncio
async def test_second_ingest_of_same_file_is_idempotent() -> None:
    settings = _make_settings()
    repo = FakeRepository()
    store = FakeObjectStore()
    parser = SuccessfulParser()
    embedding = FakeEmbeddingProvider()
    service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
    )

    first = await service.ingest_bytes(
        b"sample bytes for ingestion",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )
    second = await service.ingest_bytes(
        b"sample bytes for ingestion",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )

    assert first.status is JobStatus.PROJECTION_PENDING
    assert second.status is JobStatus.COMPLETED
    assert second.chunk_count == 0
    assert len(parser.submit_calls) == 1
    assert len(store.put_calls) == 7
    assert len(repo.indexed) == 1
    assert repo.saved_jobs[-1]["status"] is JobStatus.PROJECTION_PENDING


@pytest.mark.asyncio
async def test_chunking_settings_create_a_new_processing_revision() -> None:
    settings = _make_settings()
    repo = FakeRepository()
    store = FakeObjectStore()
    parser = SuccessfulParser()
    embedding = FakeEmbeddingProvider()
    first_service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
    )
    second_service = IngestionService(
        replace(
            settings,
            indexing=replace(
                settings.indexing,
                chunking=replace(
                    settings.indexing.chunking,
                    max_tokens=settings.indexing.chunking.max_tokens + 32,
                ),
            ),
        ),
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
    )

    first = await first_service.ingest_bytes(
        b"sample bytes for chunking profile",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )
    second = await second_service.ingest_bytes(
        b"sample bytes for chunking profile",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )

    assert first.document_revision_id != second.document_revision_id
    assert len(parser.submit_calls) == 2


@pytest.mark.asyncio
async def test_enrichment_path_uses_questions_for_the_semantic_embedding() -> None:
    settings = _make_settings()
    settings = replace(
        settings,
        indexing=replace(
            settings.indexing,
            enrichment=replace(
                settings.indexing.enrichment,
                enabled=True,
                model="chat-model",
            ),
        ),
    )
    repo = FakeRepository()
    store = FakeObjectStore()
    embedding = FakeEmbeddingProvider()
    chat = EnrichmentChat()
    service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=SuccessfulParser(),
        embedding_provider=embedding,
        chat_provider=chat,
    )

    result = await service.ingest_bytes(
        b"sample bytes for enrichment",
        source_name="notes.pdf",
        knowledge_base_id="kb-1",
    )

    assert result.status is JobStatus.PROJECTION_PENDING
    assert result.enrichment_status is EnrichmentStatus.SUCCEEDED
    assert len(chat.calls) == 1
    assert "[Title]" in chat.calls[0]["user_prompt"]
    assert embedding.calls[0] == ["Title"]
    assert embedding.calls[1][0].startswith("[Title]\n\nWhat is alpha?")
    _, chunks = load_embedded_artifact(store.put_calls[-1]["data"])
    assert chunks[0].question_kwd
    assert chunks[0].important_kwd
    assert chunks[0].metadata["header_path"] == ["Title"]
    assert chunks[0].content_with_weight == chunks[0].content


@pytest.mark.asyncio
async def test_parse_failure_is_persisted_with_failed_status() -> None:
    settings = _make_settings()
    repo = FakeRepository()
    store = FakeObjectStore()
    parser = FailingParser()
    embedding = FakeEmbeddingProvider()
    service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
    )

    with pytest.raises(IngestionError, match="MinerU rejected the file") as excinfo:
        await service.ingest_bytes(
            b"sample bytes for ingestion",
            source_name="notes.pdf",
            knowledge_base_id="kb-1",
        )

    assert excinfo.value.code == "parser_failed"
    assert repo.saved_jobs[-1]["status"] is JobStatus.PARSE_FAILED
    assert repo.saved_jobs[-1]["last_error_code"] == "parser_failed"
    assert repo.saved_jobs[-1]["last_error_message"] == "MinerU rejected the file"


@pytest.mark.asyncio
async def test_submit_error_is_normalized_to_stable_error_code() -> None:
    repo = FakeRepository()
    service = IngestionService(
        _make_settings(),
        repository=repo,
        object_store=FakeObjectStore(),
        parser=SubmitErrorParser(),
        embedding_provider=FakeEmbeddingProvider(),
    )

    with pytest.raises(
        IngestionError, match="failed to submit document to MinerU"
    ) as excinfo:
        await service.ingest_bytes(
            b"sample bytes for ingestion",
            source_name="notes.pdf",
            knowledge_base_id="kb-1",
        )

    assert excinfo.value.code == "parser_submit_error"
    assert repo.saved_jobs[-1]["last_error_code"] == "parser_submit_error"
    assert repo.saved_jobs[-1]["status"] is JobStatus.FAILED


@pytest.mark.asyncio
async def test_embedding_error_is_normalized_to_stable_error_code() -> None:
    repo = FakeRepository()
    service = IngestionService(
        _make_settings(),
        repository=repo,
        object_store=FakeObjectStore(),
        parser=SuccessfulParser(),
        embedding_provider=EmbeddingErrorProvider(),
    )

    with pytest.raises(IngestionError, match="failed to embed chunks") as excinfo:
        await service.ingest_bytes(
            b"sample bytes for ingestion",
            source_name="notes.pdf",
            knowledge_base_id="kb-1",
        )

    assert excinfo.value.code == "embedding_error"
    assert repo.saved_jobs[-1]["last_error_code"] == "embedding_error"
    assert repo.saved_jobs[-1]["status"] is JobStatus.FAILED


@pytest.mark.asyncio
async def test_parse_timeout_is_persisted_with_failed_status() -> None:
    settings = _make_settings(max_wait_seconds=0.5)
    repo = FakeRepository()
    store = FakeObjectStore()
    parser = RunningParser()
    embedding = FakeEmbeddingProvider()
    clock = MonotonicClock([0.0, 0.1, 0.6])
    service = IngestionService(
        settings,
        repository=repo,
        object_store=store,
        parser=parser,
        embedding_provider=embedding,
        sleep=_no_sleep,
        monotonic=clock,
    )

    with pytest.raises(IngestionError, match="exceeded wait deadline") as excinfo:
        await service.ingest_bytes(
            b"sample bytes for ingestion",
            source_name="notes.pdf",
            knowledge_base_id="kb-1",
        )

    assert excinfo.value.code == "parser_timeout"
    assert repo.saved_jobs[-1]["status"] is JobStatus.FAILED
    assert repo.saved_jobs[-1]["last_error_code"] == "parser_timeout"
    assert "exceeded wait deadline" in repo.saved_jobs[-1]["last_error_message"]
