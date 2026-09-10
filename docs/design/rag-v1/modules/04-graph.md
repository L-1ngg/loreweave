# M04: Graph

M04 stores qualified claims between entities and retrieves useful neighborhoods.
It answers which supported relationships to inspect; final cited answers belong
to M06.

## Interface

- Refresh source-supported claims for a source/identity revision set.
- Retrieve a bounded neighborhood for resolved entities, predicates and scope.
- Inspect a claim's supporting passages, qualifiers and coverage status.

## Ownership and dependencies

Own relationship claims, source support links, qualifiers, conflict groups and
extraction status. Read M02 sources and M03 identities. Use M08 for refresh jobs.
Store adjacency in PostgreSQL initially; hide query strategy behind neighborhood
retrieval. Do not derive primary relationships from generated Wiki prose.

## Invariants and failure behavior

Use a small versioned vocabulary for responsibility, membership, ownership,
part-of, dependency, usage and applicability. Retain original relation wording.
Preserve time, environment, conditions, negation and planned/current/historical
status; unknown qualifiers remain unknown.

Traverse only claims applicable to the question and backed by eligible source
and identity dependencies. Other valid support can retain a claim after one
source changes. Conflicting applicable claims remain separately inspectable.
Two hops, 50 entities and 100 claims per call are initial configurable caps.
Return truncation and pending-coverage information. Missing edges do not prove
absence, and a path does not automatically imply transitivity or causation.

The [graph maintenance policy](../policies/graph-maintenance.md) owns complete
source packet manifests, bounded extraction/review, predicate normalization,
identity-proof dependencies and extraction coverage. Stage generation membership
until all required packets finish; atomically replace that source's active support
generation. Partial/overflow work exposes a gap. Empty successful extraction
removes old support from this source while preserving other independent support.

## Acceptance boundary

Ask about a person's projects and their databases, then inspect every supporting
edge. Include planned migrations, negation, conflicting sources and capped dense
neighborhoods. Activate a changed source before refresh and verify obsolete
claims no longer guide the current answer.
