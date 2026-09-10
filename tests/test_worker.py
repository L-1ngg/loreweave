from __future__ import annotations

from dataclasses import replace
from hashlib import sha256

import pytest

from rag_system.processing.artifacts import build_embedded_artifact
from rag_system.infrastructure.database import OutboxEvent, ProjectionActivation
from rag_system.application.worker import IndexManager, ProjectionWorker
from test_enrichment import _chunk


class FakeRepository:
    def __init__(self, event, *, activation=None):
        self.event = event
        self.activation = activation or ProjectionActivation(active=True)
        self.activations = []
        self.completed = []
        self.failures = []
        self.links = []
        self.indexed = []

    async def claim_outbox(self, **kwargs):
        event, self.event = self.event, None
        return event

    async def list_entity_aliases(self, knowledge_base_id):
        return []

    async def link_document_entities(self, **kwargs):
        self.links.append(kwargs)

    async def mark_projection_indexed(self, revision_id):
        self.indexed.append(revision_id)

    async def activate_projection(self, revision_id):
        self.activations.append(revision_id)
        return self.activation

    async def complete_projection(self, event_id, revision_id):
        self.completed.append((event_id, revision_id))

    async def fail_outbox(self, event_id, error, retry):
        self.failures.append((event_id, error, retry))

    async def mark_projection_failed(self, revision_id, error):
        self.failures.append((revision_id, error, False))


class FakeObjectStore:
    def __init__(self, data):
        self.data = data

    async def get_bytes(self, key):
        return self.data


class FakeSearch:
    def __init__(self, *, count=0, checksums=(), alias_indices=()):
        self.projections = []
        self.count = count
        self.checksums = list(checksums)
        self.alias_indices = list(alias_indices)
        self.cutovers = []
        self.deleted_revisions = []

    async def project_chunks(self, chunks, **kwargs):
        self.projections.append((list(chunks), kwargs))

    async def delete_revision(self, revision_id, **kwargs):
        self.deleted_revisions.append(([revision_id], kwargs))

    async def delete_revisions(self, revision_ids, **kwargs):
        self.deleted_revisions.append((list(revision_ids), kwargs))

    async def count_chunks(self, **kwargs):
        return self.count

    async def list_chunk_checksums(self, **kwargs):
        return self.checksums

    async def current_alias_indices(self):
        return list(self.alias_indices)

    async def cutover_alias(self, new_index, *, old_indices):
        self.cutovers.append((new_index, list(old_indices)))


class FakeProjectionRepository:
    def __init__(self, revisions, aliases=None):
        self.revisions = revisions
        self.aliases = aliases or {}
        self.scopes = []

    async def list_projection_revisions(self, knowledge_base_id=None):
        self.scopes.append(knowledge_base_id)
        return list(self.revisions)

    async def list_entity_aliases(self, knowledge_base_id):
        return list(self.aliases.get(knowledge_base_id, []))


class FakeRebuildObjectStore:
    def __init__(self, values):
        self.values = values

    async def get_bytes(self, key):
        return self.values[key]


class FakeRebuildSearch(FakeSearch):
    def __init__(self):
        super().__init__()
        self.created_indices = []
        self.indexed_chunks = []

    async def create_physical_index(self, index):
        self.created_indices.append(index)

    async def project_chunks(self, chunks, **kwargs):
        values = list(chunks)
        self.projections.append((values, kwargs))
        self.indexed_chunks.extend(values)

    async def count_chunks(self, *, index, knowledge_base_id=None):
        return len(
            [
                chunk
                for chunk in self.indexed_chunks
                if knowledge_base_id is None
                or chunk.knowledge_base_id == knowledge_base_id
            ]
        )

    async def list_chunk_checksums(self, *, index, knowledge_base_id=None):
        return [
            chunk.checksum
            for chunk in self.indexed_chunks
            if knowledge_base_id is None or chunk.knowledge_base_id == knowledge_base_id
        ]


@pytest.mark.asyncio
async def test_worker_replays_verified_artifact_and_completes_outbox() -> None:
    data, checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[_chunk()]
    )
    event = OutboxEvent(
        event_id="projection:rev-1",
        event_type="chunk_projection.upsert",
        aggregate_id="rev-1",
        payload={
            "revision_id": "rev-1",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "artifact.json",
            "artifact_checksum": checksum,
            "chunk_count": 1,
        },
        attempts=1,
    )
    repository = FakeRepository(event)
    search = FakeSearch()
    worker = ProjectionWorker(
        repository=repository,
        search=search,
        object_store=FakeObjectStore(data),
        worker_id="worker-1",
    )
    assert await worker.process_one() is True
    assert search.projections[0][0][0].content == _chunk().content
    assert search.projections[0][1] == {"refresh": "wait_for"}
    assert repository.indexed == ["rev-1"]
    assert repository.activations == ["rev-1"]
    assert repository.completed == [("projection:rev-1", "rev-1")]
    assert search.deleted_revisions == []
    assert repository.failures == []


@pytest.mark.asyncio
async def test_worker_deletes_superseded_revisions_before_completing_outbox() -> None:
    data, checksum = build_embedded_artifact(
        revision_id="rev-2",
        revision_fingerprint="fp",
        chunks=[replace(_chunk(), document_revision_id="rev-2")],
    )
    event = OutboxEvent(
        event_id="projection:rev-2",
        event_type="chunk_projection.upsert",
        aggregate_id="rev-2",
        payload={
            "revision_id": "rev-2",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "artifact.json",
            "artifact_checksum": checksum,
            "chunk_count": 1,
        },
        attempts=1,
    )
    repository = FakeRepository(
        event,
        activation=ProjectionActivation(
            active=True,
            superseded_revision_ids=("rev-0", "rev-1"),
        ),
    )
    search = FakeSearch()
    worker = ProjectionWorker(
        repository=repository,
        search=search,
        object_store=FakeObjectStore(data),
        worker_id="worker-1",
    )

    assert await worker.process_one() is True

    assert search.deleted_revisions == [(["rev-0", "rev-1"], {"refresh": True})]
    assert repository.completed == [("projection:rev-2", "rev-2")]


@pytest.mark.asyncio
async def test_worker_removes_out_of_order_revision_instead_of_promoting_it() -> None:
    data, checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[_chunk()]
    )
    event = OutboxEvent(
        event_id="projection:rev-1",
        event_type="chunk_projection.upsert",
        aggregate_id="rev-1",
        payload={
            "revision_id": "rev-1",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "artifact.json",
            "artifact_checksum": checksum,
            "chunk_count": 1,
        },
        attempts=1,
    )
    repository = FakeRepository(event, activation=ProjectionActivation(active=False))
    search = FakeSearch()
    worker = ProjectionWorker(
        repository=repository,
        search=search,
        object_store=FakeObjectStore(data),
        worker_id="worker-1",
    )

    assert await worker.process_one() is True

    assert search.deleted_revisions == [(["rev-1"], {"refresh": True})]
    assert repository.completed == [("projection:rev-1", "rev-1")]


@pytest.mark.asyncio
async def test_cleanup_failure_retries_without_failing_activated_revision() -> None:
    class FailingCleanupSearch(FakeSearch):
        async def delete_revisions(self, revision_ids, **kwargs):
            raise RuntimeError("cleanup failed")

    data, checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[_chunk()]
    )
    event = OutboxEvent(
        event_id="projection:rev-1",
        event_type="chunk_projection.upsert",
        aggregate_id="rev-1",
        payload={
            "revision_id": "rev-1",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "artifact.json",
            "artifact_checksum": checksum,
            "chunk_count": 1,
        },
        attempts=5,
    )
    repository = FakeRepository(
        event,
        activation=ProjectionActivation(
            active=True,
            superseded_revision_ids=("rev-0",),
        ),
    )
    worker = ProjectionWorker(
        repository=repository,
        search=FailingCleanupSearch(),
        object_store=FakeObjectStore(data),
        worker_id="worker-1",
    )

    assert await worker.process_one() is True

    assert repository.completed == []
    assert len(repository.failures) == 1
    assert repository.failures[0][0] == "projection:rev-1"
    assert repository.failures[0][2] is False


@pytest.mark.asyncio
async def test_worker_rejects_external_checksum_mismatch() -> None:
    data, _ = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[_chunk()]
    )
    event = OutboxEvent(
        event_id="projection:rev-1",
        event_type="chunk_projection.upsert",
        aggregate_id="rev-1",
        payload={
            "revision_id": "rev-1",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "artifact.json",
            "artifact_checksum": sha256(b"different").hexdigest(),
            "chunk_count": 1,
        },
        attempts=1,
    )
    repository = FakeRepository(event)
    worker = ProjectionWorker(
        repository=repository,
        search=FakeSearch(),
        object_store=FakeObjectStore(data),
        worker_id="worker-1",
    )
    assert await worker.process_one() is True
    assert repository.failures[0][0] == "projection:rev-1"
    assert "checksum mismatch" in repository.failures[0][1]


def _projection_fixture():
    chunk = replace(_chunk(), checksum="chunk-checksum")
    data, artifact_checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[chunk]
    )
    revision = {
        "revision_id": "rev-1",
        "artifact_object_key": "artifact.json",
        "artifact_checksum": artifact_checksum,
        "chunk_count": 1,
    }
    return data, revision


def _scoped_projection_fixture(*, revision_id, knowledge_base_id, checksum):
    chunk = replace(
        _chunk(),
        chunk_id=f"chunk-{revision_id}",
        document_revision_id=revision_id,
        knowledge_base_id=knowledge_base_id,
        checksum=checksum,
    )
    data, artifact_checksum = build_embedded_artifact(
        revision_id=revision_id, revision_fingerprint="fp", chunks=[chunk]
    )
    key = f"{revision_id}.json"
    return data, {
        "revision_id": revision_id,
        "knowledge_base_id": knowledge_base_id,
        "artifact_object_key": key,
        "artifact_checksum": artifact_checksum,
        "chunk_count": 1,
    }


@pytest.mark.asyncio
async def test_index_verify_checks_artifact_and_es_chunk_checksums() -> None:
    data, revision = _projection_fixture()
    manager = IndexManager(
        repository=FakeProjectionRepository([revision]),
        search=FakeSearch(count=1, checksums=["chunk-checksum"]),
        object_store=FakeObjectStore(data),
    )

    report = await manager.verify("rag-chunks-v2-next", "kb-1")

    assert report.revision_count == 1
    assert report.expected_chunks == 1
    assert report.indexed_chunks == 1
    assert report.expected_checksum_count == 1
    assert report.indexed_checksum_count == 1
    assert report.matched_checksums == 1
    assert report.missing_checksums == 0
    assert report.unexpected_checksums == 0
    assert report.projection_coverage == 1.0
    assert report.verified is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("indexed_count", "checksums"),
    [(0, ["chunk-checksum"]), (1, ["different-checksum"]), (1, [])],
)
async def test_index_verify_rejects_count_or_checksum_mismatch(
    indexed_count: int, checksums: list[str]
) -> None:
    data, revision = _projection_fixture()
    manager = IndexManager(
        repository=FakeProjectionRepository([revision]),
        search=FakeSearch(count=indexed_count, checksums=checksums),
        object_store=FakeObjectStore(data),
    )

    report = await manager.verify("rag-chunks-v2-next", "kb-1")

    assert report.verified is False


@pytest.mark.asyncio
async def test_index_verify_rejects_missing_checksums_on_both_sides() -> None:
    chunk = replace(_chunk(), checksum="")
    data, artifact_checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fp", chunks=[chunk]
    )
    revision = {
        "revision_id": "rev-1",
        "artifact_object_key": "artifact.json",
        "artifact_checksum": artifact_checksum,
        "chunk_count": 1,
    }
    manager = IndexManager(
        repository=FakeProjectionRepository([revision]),
        search=FakeSearch(count=1, checksums=[]),
        object_store=FakeObjectStore(data),
    )

    report = await manager.verify("rag-chunks-v2-next", "kb-1")

    assert report.expected_checksum_count == 0
    assert report.indexed_checksum_count == 0
    assert report.projection_coverage == 0.0
    assert report.verified is False


@pytest.mark.asyncio
async def test_index_verify_rejects_external_artifact_checksum_mismatch() -> None:
    data, revision = _projection_fixture()
    revision["artifact_checksum"] = sha256(b"different").hexdigest()
    manager = IndexManager(
        repository=FakeProjectionRepository([revision]),
        search=FakeSearch(),
        object_store=FakeObjectStore(data),
    )

    with pytest.raises(ValueError, match="object checksum mismatch"):
        await manager.verify("rag-chunks-v2-next", "kb-1")


@pytest.mark.asyncio
async def test_index_rebuild_replays_every_knowledge_base_in_shared_index() -> None:
    first_data, first_revision = _scoped_projection_fixture(
        revision_id="rev-1", knowledge_base_id="kb-1", checksum="checksum-1"
    )
    second_data, second_revision = _scoped_projection_fixture(
        revision_id="rev-2", knowledge_base_id="kb-2", checksum="checksum-2"
    )
    repository = FakeProjectionRepository(
        [first_revision, second_revision],
        aliases={
            "kb-2": [
                {
                    "alias": "Apollo",
                    "entity_ref": "project:apollo-current",
                    "entity_type": "project",
                    "canonical_name": "Apollo",
                }
            ]
        },
    )
    search = FakeRebuildSearch()
    manager = IndexManager(
        repository=repository,
        search=search,
        object_store=FakeRebuildObjectStore(
            {
                "rev-1.json": first_data,
                "rev-2.json": second_data,
            }
        ),
    )

    report = await manager.rebuild(new_index="rag-chunks-v2-next")

    assert report.knowledge_base_id is None
    assert report.revision_count == 2
    assert report.expected_chunks == report.indexed_chunks == 2
    assert report.verified is True
    assert repository.scopes == [None, None]
    assert search.created_indices == ["rag-chunks-v2-next"]
    assert {chunk.knowledge_base_id for chunk in search.indexed_chunks} == {
        "kb-1",
        "kb-2",
    }
    kb_2_chunk = next(
        chunk for chunk in search.indexed_chunks if chunk.knowledge_base_id == "kb-2"
    )
    assert kb_2_chunk.entity_refs == ("project:apollo-current",)


@pytest.mark.asyncio
async def test_index_cutover_rejects_unverified_shared_projection() -> None:
    data, revision = _projection_fixture()
    search = FakeSearch(count=0, checksums=[])
    manager = IndexManager(
        repository=FakeProjectionRepository([revision]),
        search=search,
        object_store=FakeObjectStore(data),
    )

    with pytest.raises(RuntimeError, match="cutover verification failed"):
        await manager.cutover("rag-chunks-v2-next")

    assert search.cutovers == []


@pytest.mark.asyncio
async def test_index_cutover_removes_every_existing_alias_binding() -> None:
    search = FakeSearch(alias_indices=["rag-chunks-v2", "rag-chunks-v2-canary"])
    manager = IndexManager(
        repository=FakeProjectionRepository([]),
        search=search,
        object_store=FakeObjectStore(b""),
    )

    previous = await manager.cutover("rag-chunks-v2-next")

    assert previous == ["rag-chunks-v2", "rag-chunks-v2-canary"]
    assert search.cutovers == [
        (
            "rag-chunks-v2-next",
            ["rag-chunks-v2", "rag-chunks-v2-canary"],
        )
    ]
