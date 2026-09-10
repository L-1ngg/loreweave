CREATE TABLE source_notes (
 version_id uuid PRIMARY KEY REFERENCES source_versions(id),
 actor_id uuid NOT NULL REFERENCES members(id),
 project_id uuid REFERENCES projects(id),
 page_id uuid REFERENCES wiki_pages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE wiki_guidance (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL REFERENCES members(id),
 project_id uuid REFERENCES projects(id), page_id uuid REFERENCES wiki_pages(id),
 body text NOT NULL, prior_operation_id uuid REFERENCES knowledge_operations(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE wiki_version_inputs (
 version_id uuid NOT NULL REFERENCES wiki_versions(id),
 source_version_id uuid NOT NULL REFERENCES source_versions(id),
 PRIMARY KEY(version_id,source_version_id)
);
--> statement-breakpoint
INSERT INTO wiki_version_inputs SELECT DISTINCT version_id,source_version_id FROM wiki_page_sources;
--> statement-breakpoint
CREATE OR REPLACE VIEW wiki_version_eligibility AS
 SELECT v.id, NOT EXISTS (
  SELECT 1 FROM wiki_version_inputs refs JOIN source_versions s ON s.id=refs.source_version_id
  JOIN source_documents d ON d.id=s.document_id WHERE refs.version_id=v.id AND d.active_version_id IS DISTINCT FROM refs.source_version_id
 ) AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(v.identity_dependencies) ref WHERE NOT EXISTS (
   SELECT 1 FROM identity_mentions m JOIN identity_proof_eligibility p ON p.revision_id=m.current_revision_id
   WHERE m.id=(ref->>'mentionId')::uuid AND m.current_revision_id=(ref->>'revisionId')::uuid
    AND p.id=(ref->>'proofId')::uuid AND p.valid
  )
 ) AND NOT EXISTS (
  SELECT 1 FROM source_notes note JOIN source_versions s ON s.id=note.version_id
  JOIN source_documents d ON d.active_version_id=s.id WHERE note.page_id=v.page_id
  AND NOT EXISTS(SELECT 1 FROM wiki_version_inputs inputs WHERE inputs.version_id=v.id AND inputs.source_version_id=s.id)
 ) AS eligible FROM wiki_versions v;
