# M08: Durable operations

M08 gives knowledge changes a durable request identity and inspectable outcome,
and executes their background work with bounded retries and ownership fencing.

## Interface

- Submit or look up an operation by trusted scope, idempotency key and payload.
- Inspect operation outcome and per-stage readiness.
- Claim, heartbeat, complete or retry a registered job under a lease/fence.

## Ownership and dependencies

Own operation envelopes, request hashes, job attempts, lease generations and
safe failure details. The composition root registers typed domain handlers;
M08 does not import every domain module. Domain modules own their content and
participate in a shared transaction through an internal adapter.

Persist M05's dependency-enumeration and discovery cursors, coverage leftovers,
planning admission counters and wake-up conditions under the
[topic maintenance policy](../policies/wiki-topic-maintenance.md). Domain-specific
meaning remains in M05; restarting a job never resets its logical budget.

## Invariants and failure behavior

Persist an accepted operation and required job together. A repeated matching
key returns the known outcome; a changed payload fails. Check worker fencing
inside each commit, not only on job acquisition. Source activation and page
publication validate their own expected versions in that same transaction.

Retry classified transient failures with a bounded persisted attempt count.
Generation/repair budgets survive worker restarts; claiming a job again does
not reset them. A superseded source/identity revision makes obsolete jobs exit
as superseded, not publish old output. Inspect ambiguous outcomes before effects.

Initial scheduling uses one background model slot, prioritizing new interactive
admission under provider quotas. Monitor source-searchable, Wiki-ready and
graph-ready independently. Never mark the aggregate job complete while required
effects are outcome_unknown.

## Acceptance boundary

Submit a document operation, kill/replace a worker before and after a durable
effect, and inspect its eventual result through the product. Verify one effect,
no lost accepted work, stale-lease rejection, bounded repair attempts and separate
search/Wiki/graph readiness. Use real PostgreSQL for transaction/lease cases.
