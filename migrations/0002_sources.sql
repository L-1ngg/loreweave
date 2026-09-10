CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE knowledge_operations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL REFERENCES members(id), operation_key text NOT NULL,
 payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id, actor_id, operation_key)
);
--> statement-breakpoint
CREATE TABLE knowledge_jobs (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 kind text NOT NULL, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'queued',
 attempt integer NOT NULL DEFAULT 0, fence bigint NOT NULL DEFAULT 0,
 lease_until timestamptz, reason text,
 UNIQUE(operation_id, kind),
 CHECK(state IN ('queued','running','retry_wait','succeeded','failed','outcome_unknown','superseded'))
);
--> statement-breakpoint
CREATE TABLE source_documents (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 project_id uuid REFERENCES projects(id), active_version_id uuid
);
--> statement-breakpoint
CREATE TABLE source_versions (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES source_documents(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES knowledge_operations(id),
 expected_prior uuid, filename text NOT NULL, original bytea NOT NULL,
 decoded text, parser_profile text, embedding_profile text, dimensions integer,
 state text NOT NULL DEFAULT 'preparing', reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state IN ('preparing','ready','active','superseded','failed'))
);
--> statement-breakpoint
ALTER TABLE source_documents ADD CONSTRAINT source_active_version_fk
 FOREIGN KEY(active_version_id) REFERENCES source_versions(id);
--> statement-breakpoint
CREATE TABLE source_passages (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES source_versions(id),
 ordinal integer NOT NULL, kind text NOT NULL, heading_path jsonb NOT NULL,
 start_offset integer NOT NULL, end_offset integer NOT NULL, original_text text NOT NULL,
 UNIQUE(version_id, ordinal)
);
--> statement-breakpoint
CREATE TABLE source_search_records (
 id uuid PRIMARY KEY, passage_id uuid NOT NULL REFERENCES source_passages(id),
 ordinal integer NOT NULL, chunk_text text NOT NULL, lexical_text text NOT NULL,
 lexical tsvector GENERATED ALWAYS AS (to_tsvector('simple', lexical_text)) STORED,
 embedding vector NOT NULL, UNIQUE(passage_id, ordinal)
);
--> statement-breakpoint
CREATE INDEX source_lexical_idx ON source_search_records USING gin(lexical);
--> statement-breakpoint
CREATE INDEX source_versions_document_idx ON source_versions(document_id);
