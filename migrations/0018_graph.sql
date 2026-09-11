CREATE TABLE graph_generations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 document_id uuid NOT NULL REFERENCES source_documents(id), source_version_id uuid NOT NULL REFERENCES source_versions(id),
 profile text NOT NULL, state text NOT NULL CHECK(state IN ('staged','active','failed','superseded')),
 trigger_operation_id uuid NOT NULL REFERENCES knowledge_operations(id), coverage jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX graph_active_generation_idx ON graph_generations(document_id) WHERE state='active';
CREATE TABLE graph_packets (
 generation_id uuid NOT NULL REFERENCES graph_generations(id), packet_key text NOT NULL,
 source_locators jsonb NOT NULL, state text NOT NULL CHECK(state IN ('pending','reviewed','incomplete','failed')),
 exclusions jsonb NOT NULL DEFAULT '[]', relations jsonb NOT NULL DEFAULT '[]', error text,
 PRIMARY KEY(generation_id,packet_key)
);
--> statement-breakpoint
CREATE TABLE graph_claims (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), fingerprint text NOT NULL,
 subject_id uuid REFERENCES identity_entities(id), object_id uuid REFERENCES identity_entities(id),
 predicate text NOT NULL, direction text NOT NULL, qualifiers jsonb NOT NULL, relation_text text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','historical')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,fingerprint)
);
--> statement-breakpoint
CREATE TABLE graph_supports (
 claim_id uuid NOT NULL REFERENCES graph_claims(id), generation_id uuid NOT NULL REFERENCES graph_generations(id),
 source_version_id uuid NOT NULL REFERENCES source_versions(id), locators jsonb NOT NULL,
 identity_dependencies jsonb NOT NULL DEFAULT '[]', PRIMARY KEY(claim_id,generation_id)
);
--> statement-breakpoint
CREATE INDEX graph_support_source_idx ON graph_supports(source_version_id);
