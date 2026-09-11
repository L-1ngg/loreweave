ALTER TABLE graph_generations ADD COLUMN trigger_job_id uuid REFERENCES knowledge_jobs(id);
--> statement-breakpoint
CREATE UNIQUE INDEX graph_trigger_job_idx ON graph_generations(trigger_job_id) WHERE trigger_job_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE graph_packets ADD COLUMN identity_dependencies jsonb;
