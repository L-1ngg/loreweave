ALTER TABLE wiki_structure_proposals ADD COLUMN decision_key text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX wiki_structure_decision_idx ON wiki_structure_proposals(operation_id,decision_key);
