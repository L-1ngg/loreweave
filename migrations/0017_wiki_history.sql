ALTER TABLE wiki_versions ADD COLUMN restored_from uuid REFERENCES wiki_versions(id);
--> statement-breakpoint
ALTER TABLE wiki_versions ADD COLUMN reason text;

--> statement-breakpoint
CREATE TABLE wiki_edit_sets (
 id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES knowledge_jobs(id),
 operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('merge','split','restore')),
 reason text NOT NULL, restored_from uuid REFERENCES wiki_edit_sets(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE wiki_edit_pages (
 edit_set_id uuid NOT NULL REFERENCES wiki_edit_sets(id),
 page_id uuid NOT NULL REFERENCES wiki_pages(id),
 before_state jsonb, after_state jsonb NOT NULL,
 PRIMARY KEY(edit_set_id,page_id)
);
--> statement-breakpoint
CREATE TABLE wiki_page_routes (
 page_id uuid NOT NULL REFERENCES wiki_pages(id),
 successor_id uuid NOT NULL REFERENCES wiki_pages(id),
 PRIMARY KEY(page_id,successor_id), CHECK(page_id<>successor_id)
);
--> statement-breakpoint
ALTER TABLE wiki_structure_proposals ADD COLUMN status text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE wiki_structure_proposals ADD COLUMN input_manifest jsonb;
--> statement-breakpoint
ALTER TABLE wiki_structure_proposals ADD COLUMN decision_hash text;
--> statement-breakpoint
ALTER TABLE wiki_structure_proposals ADD COLUMN edit_set_id uuid REFERENCES wiki_edit_sets(id);
--> statement-breakpoint
CREATE INDEX wiki_structure_suppression_idx ON wiki_structure_proposals(organization_id,decision_hash,status);

--> statement-breakpoint
CREATE VIEW wiki_route_targets AS
 WITH RECURSIVE routes(entry_id,page_id,path) AS (
  SELECT id,id,ARRAY[id] FROM wiki_pages
  UNION ALL
  SELECT routes.entry_id,r.successor_id,routes.path||r.successor_id
  FROM routes JOIN wiki_pages p ON p.id=routes.page_id
  JOIN wiki_page_routes r ON r.page_id=p.id
  WHERE p.lifecycle IN ('redirect','split_entry') AND NOT r.successor_id=ANY(routes.path)
 ) SELECT DISTINCT routes.entry_id,routes.page_id FROM routes JOIN wiki_pages p ON p.id=routes.page_id WHERE p.lifecycle IN ('active','retired');

--> statement-breakpoint
CREATE VIEW wiki_routing_catalogue AS
 SELECT c.*,c.aliases||COALESCE((
  SELECT jsonb_agg(DISTINCT lower(regexp_replace(trim(normalize(names.value,NFKC)), '\s+', ' ', 'g'))) FROM wiki_route_targets route
  JOIN wiki_versions prior ON prior.page_id=route.entry_id,
  LATERAL jsonb_array_elements_text(COALESCE(prior.descriptor->'aliases','[]'::jsonb)||jsonb_build_array(lower(regexp_replace(trim(normalize(prior.title,NFKC)), '\s+', ' ', 'g')))) names
  WHERE route.page_id=c.page_id
 ),'[]'::jsonb) AS routing_aliases
 FROM wiki_catalogue c JOIN wiki_pages p ON p.id=c.page_id WHERE p.lifecycle IN ('active','retired');
