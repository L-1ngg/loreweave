CREATE TABLE mcp_tokens (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES owners(id),
 name text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
