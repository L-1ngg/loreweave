CREATE TABLE external_credentials (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  member_id uuid NOT NULL REFERENCES members(id),
  name text NOT NULL,
  grants jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
