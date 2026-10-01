CREATE TABLE documents (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id),
  name text NOT NULL, description text NOT NULL DEFAULT '',
  library_revision integer NOT NULL DEFAULT 0, retired_at timestamptz,
  effective_version uuid, effective_index uuid, latest_version uuid NOT NULL,
  latest_operation uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_versions (
  id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id),
  content_hash text NOT NULL, filename text NOT NULL, byte_length integer NOT NULL,
  page_count integer, extraction_meta jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_pages (
  version_id uuid NOT NULL REFERENCES source_versions(id),
  physical_page integer NOT NULL CHECK (physical_page > 0), artifact jsonb NOT NULL,
  PRIMARY KEY(version_id,physical_page)
);
CREATE TABLE index_operations (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id),
  document_id uuid NOT NULL REFERENCES documents(id), version_id uuid NOT NULL REFERENCES source_versions(id),
  submission_id uuid NOT NULL, fingerprint text NOT NULL, action text NOT NULL,
  expected_revision integer NOT NULL, latest_attempt uuid NOT NULL,
  status text NOT NULL, stage text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,submission_id)
);
CREATE TABLE indexing_attempts (
  id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES index_operations(id),
  mode text NOT NULL CHECK(mode IN ('flash','standard')), model_config jsonb NOT NULL,
  status text NOT NULL, stage text NOT NULL, reason text,
  manifests jsonb NOT NULL DEFAULT '{}', draft_tree jsonb,
  usage jsonb NOT NULL DEFAULT '{"modelCalls":0,"inputTokens":0,"outputTokens":0}',
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE index_revisions (
  id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES source_versions(id),
  attempt_id uuid NOT NULL REFERENCES indexing_attempts(id), mode text NOT NULL,
  tree jsonb NOT NULL, provenance jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE documents ADD FOREIGN KEY(effective_version) REFERENCES source_versions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE documents ADD FOREIGN KEY(effective_index) REFERENCES index_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX documents_library ON documents(owner_id,id) WHERE retired_at IS NULL;
CREATE INDEX version_document ON source_versions(document_id,created_at);
CREATE INDEX operation_document ON index_operations(document_id,created_at);
