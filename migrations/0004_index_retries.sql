CREATE TABLE index_retry_submissions (
  owner_id uuid NOT NULL REFERENCES owners(id),
  submission_id uuid NOT NULL,
  fingerprint text NOT NULL,
  attempt_id uuid NOT NULL REFERENCES indexing_attempts(id),
  PRIMARY KEY (owner_id, submission_id)
);
