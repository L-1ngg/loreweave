ALTER TABLE source_versions ADD COLUMN preparation_deadline timestamptz;
UPDATE source_versions SET preparation_deadline=created_at+interval '30 minutes';
ALTER TABLE source_versions ALTER COLUMN preparation_deadline SET DEFAULT (clock_timestamp()+interval '30 minutes');
ALTER TABLE source_versions ALTER COLUMN preparation_deadline SET NOT NULL;
--> statement-breakpoint
CREATE TABLE source_preparations (
 version_id uuid PRIMARY KEY REFERENCES source_versions(id),
 profile text NOT NULL,
 manifest jsonb NOT NULL,
 input_hash text NOT NULL
);
--> statement-breakpoint
CREATE TABLE source_embedding_batches (
 version_id uuid NOT NULL REFERENCES source_versions(id),
 profile text NOT NULL,
 ordinal integer NOT NULL,
 input_hash text NOT NULL,
 vectors jsonb NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(version_id,profile,ordinal)
);
