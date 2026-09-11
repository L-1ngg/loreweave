CREATE TABLE knowledge_job_commits (
  job_id uuid NOT NULL REFERENCES knowledge_jobs(id),
  fence bigint NOT NULL,
  outcome text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(job_id,fence)
);
--> statement-breakpoint
INSERT INTO knowledge_job_commits(job_id,fence,outcome)
SELECT id,fence,state FROM knowledge_jobs WHERE state IN ('succeeded','failed','superseded');
--> statement-breakpoint
UPDATE knowledge_jobs SET reason='needs_attention:legacy_unknown' WHERE state='outcome_unknown';
