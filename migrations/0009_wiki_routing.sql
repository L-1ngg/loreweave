ALTER TABLE wiki_catalogue ADD COLUMN title_lexical text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wiki_catalogue ADD COLUMN title_search tsvector GENERATED ALWAYS AS(to_tsvector('simple',title_lexical)) STORED;
--> statement-breakpoint
ALTER TABLE wiki_catalogue ADD COLUMN subject_ids jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX wiki_title_search_idx ON wiki_catalogue USING gin(title_search);
