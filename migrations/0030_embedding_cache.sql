CREATE TABLE embedding_cache (
 partition text NOT NULL,
 profile text NOT NULL,
 input_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('reserved','completed')),
 owner_job uuid NOT NULL REFERENCES knowledge_jobs(id),
 owner_fence bigint NOT NULL,
 request_operation text NOT NULL,
 vector jsonb,
 completed_at timestamptz,
 PRIMARY KEY(partition,profile,input_hash)
);
