CREATE TABLE conversations (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id),
  name text NOT NULL, scope jsonb NOT NULL DEFAULT '{"mode":"library"}',
  active_run uuid, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_threads (thread_id text PRIMARY KEY, messages jsonb NOT NULL);
CREATE TABLE sdk_runs (run_id text PRIMARY KEY, thread_id text NOT NULL, record jsonb NOT NULL);
CREATE INDEX sdk_runs_thread ON sdk_runs(thread_id);
CREATE TABLE knowledge_runs (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), conversation_id uuid REFERENCES conversations(id),
  thread_id text NOT NULL, channel text NOT NULL, token_id uuid,
  submission_id uuid NOT NULL, fingerprint text NOT NULL, question text NOT NULL,
  model_config jsonb NOT NULL, scope jsonb NOT NULL, pins jsonb NOT NULL,
  status text NOT NULL, reason text, result jsonb, usage jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE(owner_id, channel, submission_id)
);
CREATE TABLE source_references (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES knowledge_runs(id),
  document_id uuid NOT NULL REFERENCES documents(id), version_id uuid NOT NULL REFERENCES source_versions(id),
  physical_page integer NOT NULL CHECK(physical_page > 0), start_offset integer NOT NULL, end_offset integer NOT NULL,
  content_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX references_run ON source_references(run_id);
