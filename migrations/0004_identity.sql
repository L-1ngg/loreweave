CREATE TABLE identity_entities (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id)
);
--> statement-breakpoint
CREATE TABLE identity_mentions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 version_id uuid NOT NULL REFERENCES source_versions(id),
 passage_id uuid NOT NULL REFERENCES source_passages(id),
 start_offset integer NOT NULL, end_offset integer NOT NULL, original_text text NOT NULL,
 own_entity_id uuid NOT NULL REFERENCES identity_entities(id), current_revision_id uuid,
 UNIQUE(passage_id,start_offset,end_offset)
);
--> statement-breakpoint
CREATE TABLE identity_revisions (
 id uuid PRIMARY KEY, mention_id uuid NOT NULL REFERENCES identity_mentions(id),
 canonical_id uuid NOT NULL REFERENCES identity_entities(id), revision integer NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('distinct','confirmed','unresolved')),
 actor_id uuid REFERENCES members(id), operation_id uuid REFERENCES knowledge_operations(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(mention_id,revision)
);
--> statement-breakpoint
ALTER TABLE identity_mentions ADD CONSTRAINT identity_current_revision_fk
 FOREIGN KEY(current_revision_id) REFERENCES identity_revisions(id);
--> statement-breakpoint
CREATE INDEX identity_mentions_version_idx ON identity_mentions(version_id);
