CREATE TABLE source_attachments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL REFERENCES members(id), project_id uuid REFERENCES projects(id),
 filename text NOT NULL, original bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
