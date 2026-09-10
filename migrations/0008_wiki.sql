CREATE TABLE wiki_pages (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 project_id uuid REFERENCES projects(id), current_version_id uuid,
 lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired','redirect','split_entry')),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE wiki_versions (
 id uuid PRIMARY KEY, page_id uuid NOT NULL REFERENCES wiki_pages(id),
 operation_id uuid NOT NULL REFERENCES knowledge_operations(id), expected_prior uuid,
 title text NOT NULL, body text NOT NULL, sources jsonb NOT NULL,
 identity_dependencies jsonb NOT NULL DEFAULT '[]', certificates jsonb NOT NULL,
 descriptor jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE wiki_pages ADD CONSTRAINT wiki_current_version_fk FOREIGN KEY(current_version_id) REFERENCES wiki_versions(id);
--> statement-breakpoint
CREATE TABLE wiki_catalogue (
 page_id uuid PRIMARY KEY REFERENCES wiki_pages(id), version_id uuid NOT NULL REFERENCES wiki_versions(id),
 normalized_title text NOT NULL, aliases jsonb NOT NULL DEFAULT '[]', subject_key text NOT NULL,
 aspect_key text NOT NULL, descriptor jsonb NOT NULL, lexical_text text NOT NULL,
 lexical tsvector GENERATED ALWAYS AS(to_tsvector('simple',lexical_text)) STORED,
 embedding vector, embedding_profile text, dimensions integer
);
--> statement-breakpoint
CREATE INDEX wiki_catalogue_lexical_idx ON wiki_catalogue USING gin(lexical);
--> statement-breakpoint
CREATE INDEX wiki_catalogue_title_idx ON wiki_catalogue(normalized_title);
--> statement-breakpoint
CREATE TABLE wiki_catalogue_scopes (
 organization_id uuid NOT NULL REFERENCES organizations(id),scope text NOT NULL,
 revision bigint NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,scope)
);
--> statement-breakpoint
CREATE TABLE wiki_reservations (
 organization_id uuid NOT NULL REFERENCES organizations(id), scope text NOT NULL,
 topic_key text NOT NULL, operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 decision_id uuid NOT NULL, page_id uuid REFERENCES wiki_pages(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published','failed','outcome_unknown')),
 PRIMARY KEY(organization_id,scope,topic_key)
);
--> statement-breakpoint
CREATE TABLE wiki_page_sources (
 version_id uuid NOT NULL REFERENCES wiki_versions(id), source_version_id uuid NOT NULL REFERENCES source_versions(id),
 passage_id uuid NOT NULL REFERENCES source_passages(id), PRIMARY KEY(version_id,source_version_id,passage_id)
);
--> statement-breakpoint
CREATE INDEX wiki_reverse_sources_idx ON wiki_page_sources(source_version_id,version_id);
--> statement-breakpoint
CREATE TABLE wiki_work (
 job_id uuid PRIMARY KEY REFERENCES knowledge_jobs(id), state jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL DEFAULT now()+interval '600 seconds'
);
--> statement-breakpoint
CREATE TABLE wiki_model_attempts (
 job_id uuid NOT NULL REFERENCES knowledge_jobs(id), unit_key text NOT NULL, phase text NOT NULL,
 attempt integer NOT NULL, input_hash text NOT NULL, response jsonb,
 state text NOT NULL DEFAULT 'admitted', error text, started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,unit_key,phase,attempt)
);
--> statement-breakpoint
CREATE TABLE wiki_work_units (
 job_id uuid NOT NULL REFERENCES knowledge_jobs(id), unit_key text NOT NULL,
 deadline timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
 PRIMARY KEY(job_id,unit_key)
);
--> statement-breakpoint
CREATE VIEW wiki_version_eligibility AS
 SELECT v.id, NOT EXISTS (
  SELECT 1 FROM wiki_page_sources refs JOIN source_versions s ON s.id=refs.source_version_id
  JOIN source_documents d ON d.id=s.document_id WHERE refs.version_id=v.id AND d.active_version_id IS DISTINCT FROM refs.source_version_id
 ) AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(v.identity_dependencies) ref WHERE NOT EXISTS (
   SELECT 1 FROM identity_mentions m JOIN identity_proof_eligibility p ON p.revision_id=m.current_revision_id
   WHERE m.id=(ref->>'mentionId')::uuid AND m.current_revision_id=(ref->>'revisionId')::uuid
    AND p.id=(ref->>'proofId')::uuid AND p.valid
  )
 ) AS eligible FROM wiki_versions v;
