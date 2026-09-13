ALTER TABLE wiki_model_attempts ADD COLUMN model_request_id uuid REFERENCES model_requests(id);
