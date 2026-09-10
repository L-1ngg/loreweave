CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  username text NOT NULL,
  password_hash text NOT NULL,
  grants jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(organization_id, username)
);
--> statement-breakpoint
CREATE TABLE login_sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  UNIQUE(organization_id, name)
);
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN organization_id uuid REFERENCES organizations(id);
