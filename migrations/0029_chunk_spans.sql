ALTER TABLE source_search_records ADD COLUMN original_text text;
ALTER TABLE source_search_records ADD COLUMN start_offset integer;
ALTER TABLE source_search_records ADD COLUMN end_offset integer;
UPDATE source_search_records r SET original_text=p.original_text,start_offset=p.start_offset,end_offset=p.end_offset FROM source_passages p WHERE p.id=r.passage_id;
ALTER TABLE source_search_records ALTER COLUMN original_text SET NOT NULL;
ALTER TABLE source_search_records ALTER COLUMN start_offset SET NOT NULL;
ALTER TABLE source_search_records ALTER COLUMN end_offset SET NOT NULL;
