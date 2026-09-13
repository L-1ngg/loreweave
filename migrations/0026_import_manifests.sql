CREATE TABLE import_manifests (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL REFERENCES members(id),
 manifest_key text NOT NULL,
 input_hash text NOT NULL,
 entries jsonb NOT NULL,
 errors jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,actor_id,manifest_key)
);
