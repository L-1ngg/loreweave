ALTER TABLE knowledge_jobs ADD COLUMN job_key text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE knowledge_jobs DROP CONSTRAINT knowledge_jobs_operation_id_kind_key;
--> statement-breakpoint
ALTER TABLE knowledge_jobs ADD CONSTRAINT knowledge_job_dedup UNIQUE(operation_id,kind,job_key);
--> statement-breakpoint
CREATE TABLE identity_revalidation_batches (
 job_id uuid NOT NULL REFERENCES knowledge_jobs(id), cursor text NOT NULL,
 mention_ids jsonb NOT NULL, state text NOT NULL DEFAULT 'pending',
 proposal_count integer NOT NULL DEFAULT 0 CHECK(proposal_count BETWEEN 0 AND 2),
 review_count integer NOT NULL DEFAULT 0 CHECK(review_count BETWEEN 0 AND 2),
 deadline timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
 PRIMARY KEY(job_id,cursor)
);
