CREATE TABLE wiki_navigation (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 scope text NOT NULL,
 target_page_id uuid NOT NULL REFERENCES wiki_pages(id),
 source_version_id uuid NOT NULL REFERENCES source_versions(id),
 operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 PRIMARY KEY(organization_id,scope,target_page_id,source_version_id)
);
--> statement-breakpoint
CREATE TABLE wiki_structure_proposals (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('merge','split')), page_ids jsonb NOT NULL,
 reason text NOT NULL, input_hash text NOT NULL,
 UNIQUE(operation_id,input_hash)
);
