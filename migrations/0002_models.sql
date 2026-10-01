CREATE TABLE model_connections (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners(id),
  name text NOT NULL,
  current_revision uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE connection_revisions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES model_connections(id),
  provider text NOT NULL CHECK (provider IN ('openai','openai-compatible')),
  base_url text NOT NULL,
  sealed_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE model_connections ADD CONSTRAINT model_connection_revision
  FOREIGN KEY (current_revision) REFERENCES connection_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE model_roles (
  owner_id uuid NOT NULL REFERENCES owners(id),
  role text NOT NULL CHECK (role IN ('index','qa')),
  connection_id uuid NOT NULL REFERENCES model_connections(id),
  model text NOT NULL,
  PRIMARY KEY(owner_id,role)
);
