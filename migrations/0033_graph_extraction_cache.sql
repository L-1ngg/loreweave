CREATE TABLE graph_extraction_cache (
 document_id uuid NOT NULL REFERENCES source_documents(id), profile text NOT NULL,input_hash text NOT NULL,
 version_id uuid NOT NULL REFERENCES source_versions(id),passage_ids jsonb NOT NULL,mentions jsonb NOT NULL,response jsonb NOT NULL,
 PRIMARY KEY(document_id,profile,input_hash)
);
ALTER TABLE graph_packets ADD COLUMN extraction_reused boolean NOT NULL DEFAULT false;
