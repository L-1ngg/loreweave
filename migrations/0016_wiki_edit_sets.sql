ALTER TABLE wiki_refresh_results DROP CONSTRAINT wiki_refresh_results_pkey;
--> statement-breakpoint
ALTER TABLE wiki_refresh_results ADD PRIMARY KEY(job_id,page_id);
