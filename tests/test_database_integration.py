from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import os
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from rag_system.infrastructure.database import (
    DocumentRevisionRow,
    DocumentRow,
    PostgresRepository,
)


@pytest.fixture
async def postgres_repository():
    database_url = os.getenv("RAG_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("RAG_TEST_DATABASE_URL is not configured")

    schema = f"rag_test_{uuid4().hex}"
    admin_engine = create_async_engine(database_url)
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        database_url,
        connect_args={"server_settings": {"search_path": schema}},
    )
    repository = PostgresRepository(engine)
    await repository.create_schema_for_tests()
    try:
        yield repository
    finally:
        await repository.close()
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin_engine.dispose()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_out_of_order_projection_keeps_newest_revision_current(
    postgres_repository: PostgresRepository,
) -> None:
    created_at = datetime(2026, 8, 6, tzinfo=UTC)
    async with postgres_repository.session_factory() as session:
        session.add(
            DocumentRow(
                document_id="doc-1",
                knowledge_base_id="kb-1",
                current_revision_id=None,
                title="Document",
                source_name="document.pdf",
                metadata_json={},
                created_at=created_at,
                updated_at=created_at,
            )
        )
        session.add_all(
            [
                _revision("rev-old", created_at),
                _revision("rev-new", created_at + timedelta(seconds=1)),
            ]
        )
        await session.commit()

    old_result, new_result = await asyncio.gather(
        postgres_repository.activate_projection("rev-old"),
        postgres_repository.activate_projection("rev-new"),
    )

    assert new_result.active is True
    assert old_result.active in {True, False}
    async with postgres_repository.session_factory() as session:
        document = await session.get(DocumentRow, "doc-1")
        rows = await session.execute(
            select(DocumentRevisionRow).order_by(
                DocumentRevisionRow.document_revision_id
            )
        )
        statuses = {
            row.document_revision_id: row.status for row in rows.scalars().all()
        }
    assert document is not None
    assert document.current_revision_id == "rev-new"
    assert statuses == {"rev-new": "COMPLETED", "rev-old": "SUPERSEDED"}
    assert await postgres_repository.list_projection_revisions() == [
        {
            "revision_id": "rev-new",
            "knowledge_base_id": "kb-1",
            "artifact_object_key": "rev-new.json",
            "artifact_checksum": "checksum-rev-new",
            "chunk_count": 1,
        }
    ]


def _revision(revision_id: str, created_at: datetime) -> DocumentRevisionRow:
    return DocumentRevisionRow(
        document_revision_id=revision_id,
        document_id="doc-1",
        knowledge_base_id="kb-1",
        source_sha256=f"source-{revision_id}",
        revision_fingerprint=f"fingerprint-{revision_id}",
        source_object_key=f"{revision_id}.pdf",
        source_name="document.pdf",
        title=revision_id,
        parser_provider="mineru",
        parser_version="vlm",
        enrichment_profile_id="default-v1",
        status="INDEXED",
        blocks_json=[],
        metadata_json={},
        artifact_object_key=f"{revision_id}.json",
        artifact_checksum=f"checksum-{revision_id}",
        chunk_count=1,
        created_at=created_at,
    )
