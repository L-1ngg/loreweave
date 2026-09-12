# M08: Durable operations

M08 gives knowledge changes a durable request identity and inspectable outcome,
and executes their background work with bounded retries and ownership fencing.

## Interface

- Submit or look up an operation by trusted scope, idempotency key and payload.
- Inspect operation outcome and per-stage readiness.
- Execute eligible leased work, including renewal, ownership cancellation and
  failure settlement. Domain handlers supply work and transactional failure effects.
- Checkpoint or complete a claimed job under its fence; inspect commit receipts.

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

`Operations.execute` owns the claim-to-settlement lifecycle for Sources, Wiki and
Graph workers. Its promise remains pending until the handler's started model,
admission and persistence work, and any in-flight renewal, have settled. Handlers
must await started work; requesting cancellation is not proof of termination.
`Operations.signal` combines ownership cancellation with a caller's existing
deadline. A provider that ignores cancellation keeps its caller pending until it
actually returns; the executor does not detach it or report early settlement.

Renew every one-third of the lease interval, without overlapping renewals. Defaults
remain 60 seconds for Sources, 120 seconds for Graph and 600 seconds for Wiki.
Graph's optional execution configuration can shorten the lease without changing
packet deadlines. Renewal changes only `lease_until`, never attempts, fences,
generation identity, packet progress, model admissions or logical deadlines.
The database accepts renewal only for an unexpired current fence. A conservative
monotonic local expiry guard stops admission even if renewal is blocked or its
acknowledgement is delayed. Neither a late renewal nor a recovered connection
reactivates a locally canceled execution.

On failed renewal or uncertain ownership, cancel cooperative work and reject new
checkpoints and model dispatch. The old worker leaves failure handling to the
replacement; it cannot mark the replacement's work failed. Ordinary domain
failures settle through the same fenced commit/receipt transaction as success.
Renewal ends after settlement, including when a handler exits without a known
durable outcome; such a job becomes recoverable after lease expiry. Raw `claim`
remains available for explicit recovery and ownership cases and does not renew
automatically. Wiki still owns dependency eligibility and catalogue wake rules.

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

Persist identity proof-revalidation cursors, graph packet/generation membership,
Wiki inspection ledgers and all generation/review admissions before dispatch.
See [identity provenance](../policies/identity-provenance.md),
[graph maintenance](../policies/graph-maintenance.md) and
[evidence validation](../policies/evidence-validation.md). Recovery does not reset
root budgets or deadlines. Successful Wiki retirement is a durable disposition;
`needs_attention` is a failure reason with unresolved ranges, not a new job state.

## Acceptance boundary

Submit a document operation, kill/replace a worker before and after a durable
effect, and inspect its eventual result through the product. Verify one effect,
no lost accepted work, stale-lease rejection, bounded repair attempts and separate
search/Wiki/graph readiness. Use real PostgreSQL for transaction/lease cases.
