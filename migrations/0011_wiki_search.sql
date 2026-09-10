ALTER TABLE wiki_catalogue ADD COLUMN body_lexical text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wiki_catalogue ADD COLUMN body_search tsvector GENERATED ALWAYS AS(to_tsvector('simple',body_lexical)) STORED;
--> statement-breakpoint
CREATE INDEX wiki_catalogue_body_idx ON wiki_catalogue USING gin(body_search);
