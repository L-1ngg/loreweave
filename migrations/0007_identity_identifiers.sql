CREATE TABLE identity_identifiers (
 mention_id uuid NOT NULL REFERENCES identity_mentions(id),
 namespace text NOT NULL, scope text NOT NULL, value text NOT NULL,
 PRIMARY KEY(mention_id,namespace,scope,value)
);
--> statement-breakpoint
CREATE INDEX identity_identifier_lookup_idx ON identity_identifiers(namespace,scope,value);
