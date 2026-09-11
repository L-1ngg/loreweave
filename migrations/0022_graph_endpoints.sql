ALTER TABLE graph_packets ADD COLUMN endpoint_mentions jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
UPDATE graph_packets p SET endpoint_mentions=(
  SELECT COALESCE(jsonb_agg(DISTINCT endpoint), '[]') FROM (
    SELECT r->>'subjectMention' AS endpoint FROM jsonb_array_elements(p.relations) r
    UNION SELECT r->>'objectMention' FROM jsonb_array_elements(p.relations) r
    UNION SELECT e->>'mention' FROM jsonb_array_elements(p.exclusions) e
  ) refs WHERE endpoint IS NOT NULL
);
