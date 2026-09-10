ALTER TABLE wiki_pages ADD COLUMN retirement jsonb;
--> statement-breakpoint
CREATE TABLE wiki_refresh_results (
 job_id uuid PRIMARY KEY REFERENCES knowledge_jobs(id),
 page_id uuid NOT NULL REFERENCES wiki_pages(id),
 revision_set text NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('published','retired','coalesced')),
 version_id uuid NOT NULL REFERENCES wiki_versions(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
