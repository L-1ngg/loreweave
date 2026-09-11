ALTER TABLE wiki_model_attempts ADD COLUMN model_profile text NOT NULL DEFAULT 'unrecorded';
--> statement-breakpoint
ALTER TABLE wiki_model_attempts ADD COLUMN prompt_profile text NOT NULL DEFAULT 'unrecorded';
--> statement-breakpoint
ALTER TABLE wiki_model_attempts ADD COLUMN dispatched_at timestamptz;
--> statement-breakpoint
ALTER TABLE wiki_model_attempts ADD COLUMN completed_at timestamptz;
--> statement-breakpoint
CREATE TABLE wiki_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES wiki_pages(id),
  operation_id uuid NOT NULL REFERENCES knowledge_operations(id),
  version_id uuid NOT NULL REFERENCES wiki_versions(id),
  from_state text NOT NULL, to_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE INDEX wiki_lifecycle_operation_idx ON wiki_lifecycle_events(operation_id);
--> statement-breakpoint
CREATE FUNCTION record_wiki_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation uuid;
BEGIN
  operation := nullif(current_setting('loreweave.operation_id', true), '')::uuid;
  INSERT INTO wiki_lifecycle_events(page_id,operation_id,version_id,from_state,to_state)
  VALUES(NEW.id,operation,NEW.current_version_id,OLD.lifecycle,NEW.lifecycle);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wiki_lifecycle_record AFTER UPDATE OF lifecycle ON wiki_pages
FOR EACH ROW WHEN (OLD.lifecycle IS DISTINCT FROM NEW.lifecycle)
EXECUTE FUNCTION record_wiki_lifecycle();
