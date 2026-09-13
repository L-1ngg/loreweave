ALTER TABLE model_requests ADD COLUMN provider_key text NOT NULL DEFAULT '';
CREATE TABLE model_provider_cooldowns (
 provider_key text PRIMARY KEY,
 until_at timestamptz NOT NULL
);
