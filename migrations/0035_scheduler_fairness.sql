ALTER TABLE knowledge_jobs ADD COLUMN schedule_scope text;
ALTER TABLE knowledge_jobs ADD COLUMN last_claimed_at timestamptz;
UPDATE knowledge_jobs j SET schedule_scope=o.organization_id::text||':'||coalesce(
 (SELECT d.project_id::text FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE v.operation_id=j.operation_id),
 (SELECT p.project_id::text FROM wiki_pages p WHERE p.id::text=j.payload->>'pageId'),'shared')
FROM knowledge_operations o WHERE o.id=j.operation_id;
ALTER TABLE knowledge_jobs ALTER COLUMN schedule_scope SET NOT NULL;
ALTER TABLE knowledge_jobs ALTER COLUMN schedule_scope SET DEFAULT 'legacy';
CREATE INDEX knowledge_jobs_scope_claim ON knowledge_jobs(schedule_scope,last_claimed_at);
