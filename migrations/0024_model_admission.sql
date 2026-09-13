CREATE TABLE model_requests (
 id uuid PRIMARY KEY,
 operation_id text NOT NULL,
 input_hash text NOT NULL,
 owner uuid NOT NULL,
 fence bigint NOT NULL DEFAULT 1,
 priority text NOT NULL CHECK(priority IN ('interactive','background')),
 state text NOT NULL CHECK(state IN ('queued','reserved','dispatched','settled','uncertain','expired')),
 deadline timestamptz NOT NULL,
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 admitted_at timestamptz,
 dispatched_at timestamptz,
 settled_at timestamptz,
 provider_request_id text,
 outcome text,
 reconciliation jsonb
);
--> statement-breakpoint
CREATE INDEX model_requests_active ON model_requests(state,priority,queued_at);
