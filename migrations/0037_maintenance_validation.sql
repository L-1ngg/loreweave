ALTER TABLE wiki_model_attempts ADD COLUMN validation_issues jsonb NOT NULL DEFAULT '[]';
