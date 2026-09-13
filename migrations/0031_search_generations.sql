CREATE TABLE source_search_generations (
 id uuid PRIMARY KEY REFERENCES knowledge_operations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 embedding_profile text NOT NULL, dimensions integer NOT NULL,
 chunk_profile text NOT NULL, prior_generation uuid REFERENCES source_search_generations(id),
 prior_profile text, prior_dimensions integer,
 state text NOT NULL DEFAULT 'building' CHECK(state IN ('building','active','superseded','failed','rolled_back')),
 deadline timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '30 minutes'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reason text
);
CREATE TABLE source_search_heads (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 generation_id uuid REFERENCES source_search_generations(id),
 embedding_profile text NOT NULL, dimensions integer NOT NULL
);
INSERT INTO source_search_heads(organization_id,embedding_profile,dimensions)
SELECT DISTINCT ON(d.organization_id) d.organization_id,v.embedding_profile,v.dimensions
FROM source_documents d JOIN source_versions v ON v.id=d.active_version_id
ORDER BY d.organization_id,v.created_at DESC;
CREATE TABLE source_search_coverage (
 generation_id uuid NOT NULL REFERENCES source_search_generations(id),
 version_id uuid NOT NULL REFERENCES source_versions(id),
 manifest_hash text NOT NULL, completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(generation_id,version_id)
);
ALTER TABLE source_search_records ADD COLUMN generation_id uuid REFERENCES source_search_generations(id);
ALTER TABLE source_search_records DROP CONSTRAINT source_search_records_passage_id_ordinal_key;
CREATE UNIQUE INDEX source_search_base_ordinal ON source_search_records(passage_id,ordinal) WHERE generation_id IS NULL;
CREATE UNIQUE INDEX source_search_generation_ordinal ON source_search_records(generation_id,passage_id,ordinal) WHERE generation_id IS NOT NULL;
