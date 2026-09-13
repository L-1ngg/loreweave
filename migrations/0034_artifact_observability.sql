ALTER TABLE model_requests ADD COLUMN parent_operation_id text;
CREATE INDEX model_request_parent_idx ON model_requests(parent_operation_id);
CREATE TABLE maintenance_artifact_reuse (
 job_id uuid NOT NULL REFERENCES knowledge_jobs(id), kind text NOT NULL, input_hash text NOT NULL,
 PRIMARY KEY(job_id,kind,input_hash)
);
CREATE TABLE source_changes (
 version_id uuid PRIMARY KEY REFERENCES source_versions(id), previous_version_id uuid REFERENCES source_versions(id), delta jsonb NOT NULL
);
