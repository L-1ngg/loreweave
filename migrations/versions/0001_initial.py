"""Create PostgreSQL business source of truth and outbox.

Revision ID: 0001_initial
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("document_id", sa.String(160), primary_key=True),
        sa.Column("knowledge_base_id", sa.String(128), nullable=False),
        sa.Column("current_revision_id", sa.String(160)),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_documents_kb", "documents", ["knowledge_base_id"])
    op.create_table(
        "document_revisions",
        sa.Column("document_revision_id", sa.String(160), primary_key=True),
        sa.Column("document_id", sa.String(160), nullable=False),
        sa.Column("knowledge_base_id", sa.String(128), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("revision_fingerprint", sa.String(128), nullable=False),
        sa.Column("source_object_key", sa.Text(), nullable=False),
        sa.Column("source_name", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("parser_provider", sa.String(80), nullable=False),
        sa.Column("parser_version", sa.String(160), nullable=False),
        sa.Column("enrichment_profile_id", sa.String(160), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("blocks_json", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("artifact_object_key", sa.Text(), nullable=False),
        sa.Column("artifact_checksum", sa.String(64), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "knowledge_base_id",
            "document_id",
            "source_sha256",
            "revision_fingerprint",
            name="uq_revision_processing_fingerprint",
        ),
    )
    op.create_index("ix_revisions_document", "document_revisions", ["document_id"])
    op.create_index("ix_revisions_kb", "document_revisions", ["knowledge_base_id"])
    op.create_table(
        "ingestion_jobs",
        sa.Column("job_id", sa.String(160), primary_key=True),
        sa.Column("document_id", sa.String(160), nullable=False),
        sa.Column("document_revision_id", sa.String(160), nullable=False),
        sa.Column("knowledge_base_id", sa.String(128), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("source_name", sa.Text(), nullable=False),
        sa.Column("source_object_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("parse_provider", sa.String(80), nullable=False),
        sa.Column("parse_task_id", sa.String(240), nullable=False),
        sa.Column("parse_result_object_key", sa.Text(), nullable=False),
        sa.Column("embedding_profile_id", sa.String(160), nullable=False),
        sa.Column("enrichment_profile_id", sa.String(160), nullable=False),
        sa.Column("revision_fingerprint", sa.String(128), nullable=False),
        sa.Column("chunking_version", sa.String(80), nullable=False),
        sa.Column("embedded_chunks_object_key", sa.Text(), nullable=False),
        sa.Column("embedded_chunks_checksum", sa.String(64), nullable=False),
        sa.Column("enrichment_status", sa.String(40), nullable=False),
        sa.Column("enrichment_failed_chunks", sa.Integer(), nullable=False),
        sa.Column("enrichment_error_summary", sa.Text(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(120), nullable=False),
        sa.Column("last_error_message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_jobs_revision", "ingestion_jobs", ["document_revision_id"])
    op.create_index("ix_jobs_kb", "ingestion_jobs", ["knowledge_base_id"])
    op.create_table(
        "outbox_events",
        sa.Column("event_id", sa.String(200), primary_key=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("aggregate_id", sa.String(160), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("leased_until", sa.DateTime(timezone=True)),
        sa.Column("leased_by", sa.String(160), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_outbox_claim",
        "outbox_events",
        ["status", "available_at", "created_at"],
    )
    op.create_table(
        "enrichment_cache",
        sa.Column("cache_key", sa.String(128), primary_key=True),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("chat_model", sa.String(240), nullable=False),
        sa.Column("prompt_version", sa.String(100), nullable=False),
        sa.Column("language", sa.String(32), nullable=False),
        sa.Column("keyword_top_n", sa.Integer(), nullable=False),
        sa.Column("question_top_n", sa.Integer(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "entities",
        sa.Column("knowledge_base_id", sa.String(128), primary_key=True),
        sa.Column("entity_ref", sa.String(240), primary_key=True),
        sa.Column("entity_type", sa.String(80), nullable=False),
        sa.Column("canonical_name", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "entity_aliases",
        sa.Column("alias_id", sa.String(240), primary_key=True),
        sa.Column("knowledge_base_id", sa.String(128), nullable=False),
        sa.Column("entity_ref", sa.String(240), nullable=False),
        sa.Column("alias", sa.Text(), nullable=False),
        sa.Column("normalized_alias", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["knowledge_base_id", "entity_ref"],
            ["entities.knowledge_base_id", "entities.entity_ref"],
        ),
    )
    op.create_index(
        "ix_entity_alias_lookup",
        "entity_aliases",
        ["knowledge_base_id", "normalized_alias"],
    )
    op.create_table(
        "document_entity_links",
        sa.Column("knowledge_base_id", sa.String(128), primary_key=True),
        sa.Column("document_revision_id", sa.String(160), primary_key=True),
        sa.Column("entity_ref", sa.String(240), primary_key=True),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for table in (
        "document_entity_links",
        "entity_aliases",
        "entities",
        "enrichment_cache",
        "outbox_events",
        "ingestion_jobs",
        "document_revisions",
        "documents",
    ):
        op.drop_table(table)
