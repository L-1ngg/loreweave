CREATE TABLE owners (
  singleton text PRIMARY KEY CHECK (singleton = 'owner'),
  id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners(id),
  credential_version text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
