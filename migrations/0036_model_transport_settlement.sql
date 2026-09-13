ALTER TABLE model_requests ADD COLUMN transport_deadline timestamptz,
 ADD COLUMN consumer_ended_at timestamptz,
 ADD COLUMN response_started_at timestamptz,
 ADD COLUMN response_status integer,
 ADD COLUMN capacity_released_at timestamptz,
 ADD COLUMN capacity_release jsonb;

CREATE INDEX model_requests_held_capacity ON model_requests(priority,state)
 WHERE capacity_released_at IS NULL AND state IN ('reserved','dispatched','uncertain');
