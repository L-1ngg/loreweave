# M03: Entity identity

M03 owns whether mentions denote the same knowledge entity. It is shared by
Wiki and graph, so producing a Wiki does not depend on completed graph extraction.

## Interface

- Resolve a bounded set of source mentions into confirmed identities or distinct
  unresolved candidates, with the evidence and scope of each decision.
- Read an identity, aliases, source mentions and its resolution revision.
- Apply an evidenced identity correction and inspect the resulting changes.
- Validate identity-revision and transitive proof-source dependencies for derived content.

## Ownership and dependencies

Own source mentions, canonical entities, scoped identifiers, aliases, identity
resolution records and monotonic identity revisions. Read M02 source references;
schedule affected knowledge revalidation through M08. Similarity search is an
internal candidate-finding adapter, not a proof of identity.

## Invariants and failure behavior

Shared names or similar embeddings alone never merge entities, even within one
project. Unknown identity associations remain non-authoritative and cannot be
traversed as equivalence facts. Preserve the basis and scope of each resolution.

Merges preserve original mentions and provenance so a later correction can
reassign mentions without inventing evidence. Advance identity revisions and
invalidate affected Wiki/graph dependencies before relying on corrected identities.
Resolve ambiguous natural-language correction targets before effects.

The [identity provenance policy](../policies/identity-provenance.md) owns proof
manifests, alternative support, reverse dependency traversal, bounded reconciliation
and publication fencing. Consumers retain mention bindings and proof revisions;
canonical IDs alone cannot certify equivalence. Updating the sole identity-proof
source invalidates joined facts even when the relationship sources are unchanged.

## Acceptance boundary

Use two same-named services in different projects and one explicitly shared
service. Verify distinct/shared answers and inspect the supporting passages.
Correct a mistaken merge, then verify affected graph/Wiki claims become ineligible
until rebuilt while unrelated entities remain usable.
