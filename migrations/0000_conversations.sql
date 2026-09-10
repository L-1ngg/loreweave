CREATE TABLE IF NOT EXISTS conversations (
      id uuid PRIMARY KEY, leaf_id uuid, fence bigint NOT NULL DEFAULT 0
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS session_entries (
      conversation_id uuid NOT NULL REFERENCES conversations(id),
      id uuid NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
      entry jsonb NOT NULL, PRIMARY KEY(conversation_id, id)
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS conversation_runs (
      id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
      ordinal bigint GENERATED ALWAYS AS IDENTITY, snapshot jsonb NOT NULL,
      question text NOT NULL, deadline bigint NOT NULL, writer_fence bigint,
      cancel_requested boolean NOT NULL DEFAULT false
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_events (
      run_id uuid NOT NULL REFERENCES conversation_runs(id), sequence integer NOT NULL,
      event jsonb NOT NULL, PRIMARY KEY(run_id, sequence)
    );
