CREATE TABLE wiki_dependency_walks (
 job_id uuid PRIMARY KEY REFERENCES knowledge_jobs(id),
 cursor text NOT NULL DEFAULT '',complete boolean NOT NULL DEFAULT false,
 page_ids jsonb NOT NULL DEFAULT '[]',batch_sizes jsonb NOT NULL DEFAULT '[]'
);
