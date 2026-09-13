# Issue 28 runtime contract

This document adopts [issue 28](https://github.com/L-1ngg/loreweave/issues/28)
for M02–M08 and shared contract C05. It supersedes conflicting statements about
mandatory online draft/review calls, phase reserves, fixed character slicing,
automatic graph routing/adjacent bridges, synchronous Wiki vectors, and
organization-wide graph identity epochs. Independent **maintenance** support
review, access checks, immutable originals, exact identity proofs and fenced
transactional publication remain required. The older documents retain the
construction history and continue to govern unaffected behavior.

## Online answers and retrieval

The Agent's final structured answer is the answer. `direct-answer-v2` carries
`validation: { kind: "citation-traceability", semanticReview: false }`.
Historical certificates remain historical and are not generated for these new
answers. Deterministic checks establish issued handles, original spans, trusted
scope and freshness; they do not establish semantic entailment. Unvalidated
streamed content is provisional. Browser, HTTP, stored results and MCP use the
same Host result. No-retrieval answers display exactly
**通识回答，未查询知识库**. Mixed answers must distinguish general explanation from
private facts. Missing support and conflicts remain explicit.

The Agent selects `source`, `wiki`, `graph` or combinations, with `source` as
an omitted-argument default. Selected routes run concurrently. Scope comes from
the run's trusted context, never tool arguments. Graph defaults to one hop;
two hops require an explicit indirect need. Direction, qualifiers, aliases,
scoped ambiguity and discovery paths survive retrieval. A path is not a
certificate of transitive factual entailment. Limits remain eight seeds,
50 entities, 100 claims, 20 Wiki pages and 50 resolved Wiki originals per call.
Wiki references are ranked by matching reviewed claim text; historical pages
without a relevant claim association use a bounded page fallback.

Ordinary/complex deadlines are 30/60 seconds and dispatched retrieval round
limits are two/three. Follow-ups identify a concrete gap; unchanged cache hits
consume no retrieval round or query embedding. A follow-up with no new evidence
stops further dispatch. The serialized evidence view, including metadata, is
bounded to 8,000/16,000 **UTF-8 bytes**, not tokens. `context_limit` is a packing
diagnostic, not an automatic partial-answer decision. Registry handles survive
follow-ups; deltas avoid duplicating original text. Span identity includes
version, original passage and subrange. Route duplication is not independent
corroboration. Current implementation conservatively invalidates derived-handle
reuse on an organization dependency snapshot change, including unrelated changes.

## Admission, settlement and workers

PostgreSQL `model_requests` is the single runtime HTTP admission authority. All
configured SDK/chat/embedding transports use it. Eight requests may be reserved,
dispatched or uncertain globally within this authority; background may use six.
Interactive waiters have priority for available eligible capacity. Slots last
through response-body/stream settlement. Physical HTTP batches and retries each
acquire a slot; domain/CPU job counts are different metrics.

The logical deadline includes queue time and survives recovery. Execution is
capped at 45 seconds after admission and clipped by that deadline. Queued-only
attempts are not model executions. Maintenance attempts link to transport IDs,
so a known pre-dispatch cancellation does not consume the execution allowance.
Owner heartbeats use lease/fence checks; expired undispatched owners are fenced
before reservation reclamation and replay checks. A dispatched request without
confirmed settlement retains capacity as uncertain. Local timeout/abort, lease
expiry or process death is not proof of remote termination. There is no
exactly-once execution or billing promise.

`LOREWEAVE_ROLE=all|api|worker` selects bootstrap roles (default `all`). Workers
share the same database and profiles; do not create separate admission databases
for a single running deployment. Source, search-index, identity, Wiki and graph
lanes progress independently. The runtime runs two Wiki lanes. Stage selection
orders eligible project scopes by their last claim, then original acceptance
order. Source preparation yields after one completed embedding batch and graph
work after one completed packet in the runtime; reusable work and deadlines stay
in PostgreSQL. Close stops new claims, drains accepted local executions, then
closes transports and database connections. Multiple API instances and database
HA are separate deployment gates; this bootstrap does not claim those validated.

Use `DATABASE_URL=... bun run model:status` for request/uncertainty inspection.
After obtaining actual provider completion/termination evidence, reconcile with:

```sh
bun run model:status reconcile REQUEST_UUID provider-completed EVIDENCE_REFERENCE
```

The reference is recorded durably. A timeout observation is not valid evidence.
Provider cooldown, queued/admitted/dispatched/settled times, request IDs, parent
operation IDs and operation readiness are inspectable. Cost is explicitly
unavailable where the provider does not supply attributable billing data.

## Imports, chunks and search generations

Acceptance atomically persists original bytes, operation identity and its job.
Compatible idempotency retries return the original receipt. `POST /import-batches`
accepts up to 20 attachment references with independent document transactions;
`GET /import-batches/:id` reconstructs individual outcomes after lost responses.
Existing 1 MiB Markdown sources and 2 MiB request envelopes still apply.

Initial pending-backlog limits are 256 MiB / 2,000 jobs / 524,288 estimated work
units per organization and 128 MiB / 1,000 jobs / 262,144 units per project or
shared scope. A unit is `ceil(originalBytes / 512)`, an estimate, not tokens.
`LOREWEAVE_IMPORT_ORGANIZATION_BYTES`, `_JOBS`, `_WORK` and corresponding
`LOREWEAVE_IMPORT_PROJECT_BYTES`, `_JOBS`, `_WORK` configure those six positive
integer limits. Concurrent acceptance checks share an organization transaction
lock. Excess new work gets HTTP 503, retryable `import_overloaded`, Retry-After 5.
Already accepted work is never evicted.

Preparation persists its parse/chunk manifest, profile, physical batch size,
completed embedding batches and a persisted total deadline from acceptance (default
30 minutes; `LOREWEAVE_SOURCE_PREPARATION_SECONDS` configures 1–86,400 seconds). Structural
chunks target 512 embedding-input tokens and cap at 768 including search-only
headings/header prefixes; overlap is zero. Original UTF-16 offsets remain exact
for CRLF and non-BMP text. Prefixes are not quotations. Controlled adapters use
an explicitly named UTF-8-byte profile. Real BGE-M3 uses its hash-verified pinned
tokenizer (`bun run prepare:tokenizer`); unknown tokenizers fail configuration.
The tokenizer pin does not claim a remote deployment's weight revision.

The embedding fingerprint includes deployment, operator revision, dimensions,
role/input profile and normalization mode. `RAG_EMBEDDING_REVISION` defaults to
operator epoch `operator-deployment-v1`; operators must change the epoch and
rebuild when the remote alias changes. This is an operator configuration contract,
not automatic detection of remote model changes. Physical batches cap at 32
texts or the smaller configured item count. Explicit HTTP 413 permits finite
subdivision; authentication/schema/vector errors do not. Validated completed
physical sub-batches checkpoint before subsequent requests. Exact-input cache
partitions include organization/project and document role, with durable ownership
and uncertain-request checks. Wrong-space vectors never participate in cosine
comparison.

Search generations are independent of source versions. Admin
`POST /search-indexes {key}` builds the configured profile beside the active
organization head; `GET /search-indexes/:id` reports its durable state.
Cutover catches up source changes under the activation lock and fences the
expected prior head. Source activation after cutover enqueues `source.index`
catch-up. An unavailable active profile or incomplete compatible coverage is
explicitly lexical-only/partially lexical-only. Admin
`POST /search-indexes/:id/rollback` switches the head without reverting source
truth; newer source originals remain current. Search-only work never enqueues
Wiki/graph derivation. Historical passages and citations remain resolvable.

## Incremental maintenance and compatibility

Source activation records all current ranges and removed/changed prior ranges
in `source_changes`. Exact reuse requires text, structure and governing-context
agreement; duplicate or uncertain mapping cannot authorize reuse. Existing
reverse-dependency cursors and current-source/proof eligibility checks continue
to cover deletions, old page inputs and transitive identity evidence. A cap or
unresolved mapping must remain a visible incomplete outcome, never silent success.

Wiki planning assigns reader-question sections, stable IDs and bounded
continuation units; source packets are input windows, not page identities.
Section metadata, claims, original spans, context hashes and review hashes persist
with the version. Two bounded local lanes process independent sections concurrently;
continuations within a section stay ordered, and publication waits for every
started section to settle. Compatible mapped prose can skip generation, while a new source
manifest still requires renewed support review. Unmapped/changed input regenerates
under the existing finite budgets. Title and section headings are reviewed claims.
Assembly removes repeated reviewed headings; `publishedRanges` maps assembled
text to exact reviewed draft ranges. Legacy certificates without section/context
provenance take the rebuild path. No fabricated inherited certificates are added.

Reviewed Wiki content and lexical catalogue publish atomically with optional
`wiki.project` work. An unchanged compatible descriptor vector is reused; absence
of a vector alone does not prevent justified topic creation after authoritative
catalogue/collision checks. Identity/topic ambiguity still defers. Failure to
review cannot authorize publication or retirement.

Graph raw extraction checkpoints separately from bindings and review. Compatible
unambiguous source-local extraction may be remapped; binding/support review is
renewed. Ambiguous repeated packets and unresolved exclusions are conservatively
re-extracted. Only actual referenced endpoint changes invalidate extraction-time
registration, not an unrelated organization identity event. Explicit anchors and
split structures create bounded bridges; simple adjacency creates no extra call.
Complete packet coverage gates generation publication. Successful empty output
replaces this source's memberships while preserving independent source support.

Migrations 0024–0035 add durable admission, checkpoints, manifests, chunks/cache,
search generations, transport accounting, raw graph cache, source deltas and
scope scheduling without deleting originals, history or accepted jobs. No automatic
retention deletion is enabled: historical references, active artifacts and
uncertain requests remain protected. Production retention/storage limits require
an operator policy and measured corpus; this implementation does not delete
accepted history to manufacture a storage or HA claim.

## Acceptance evidence

Controlled software tests, actual provider development results, independently
assessed semantic quality and production capacity are different evidence. The
ordinary 15-second p95 target remains unproven until measured on the intended
workload. [Issue 18](https://github.com/L-1ngg/loreweave/issues/18)'s 1,000 documents,
20 million characters and five concurrent requests gate is unchanged. Hardware,
provider RPM/TPM, replication/failover, RPO/RTO and restore evidence must be stated
before production HA/capacity acceptance. Issue 25's negative baseline remains
historical evidence. No issue is closed by this contract adoption.

Fixed-route evaluation controls explicitly execute source, source+Wiki,
source+graph or combined retrieval; production leaves route choice to the Agent.
Capacity report schema 2 names `validatedDelivery`/`validatedDeliveries`, replacing
schema 1's reviewer-specific fields. Delivery validation accepts the direct
traceability contract or a historical review certificate, but is not semantic
scoring. A delivered explicit evidence gap may reach independent scoring without
citations; failed requests never pass merely by returning an expected error code.
See [implementation and evaluation evidence](../../evaluation/issue-28/README.md).
