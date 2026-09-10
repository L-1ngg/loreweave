CREATE TABLE identity_proofs (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES identity_revisions(id),
 kind text NOT NULL, explanation text NOT NULL
);
--> statement-breakpoint
CREATE TABLE identity_proof_leaves (
 proof_id uuid NOT NULL REFERENCES identity_proofs(id),
 version_id uuid NOT NULL REFERENCES source_versions(id),
 passage_id uuid NOT NULL REFERENCES source_passages(id),
 PRIMARY KEY(proof_id,version_id,passage_id)
);
--> statement-breakpoint
CREATE TABLE identity_proof_bindings (
 proof_id uuid NOT NULL REFERENCES identity_proofs(id),
 mention_id uuid NOT NULL REFERENCES identity_mentions(id),
 revision_id uuid NOT NULL REFERENCES identity_revisions(id),
 PRIMARY KEY(proof_id,mention_id)
);
--> statement-breakpoint
CREATE INDEX identity_reverse_leaves_idx ON identity_proof_leaves(version_id,proof_id);
--> statement-breakpoint
CREATE INDEX identity_reverse_bindings_idx ON identity_proof_bindings(mention_id,proof_id);
--> statement-breakpoint
CREATE VIEW identity_proof_eligibility AS
 SELECT p.*, NOT EXISTS (
  SELECT 1 FROM identity_proof_leaves l JOIN source_versions v ON v.id=l.version_id
  JOIN source_documents d ON d.id=v.document_id WHERE l.proof_id=p.id AND d.active_version_id IS DISTINCT FROM l.version_id
 ) AND NOT EXISTS (
  SELECT 1 FROM identity_proof_bindings b JOIN identity_mentions m ON m.id=b.mention_id
  WHERE b.proof_id=p.id AND m.current_revision_id IS DISTINCT FROM b.revision_id
 ) AS valid FROM identity_proofs p;
