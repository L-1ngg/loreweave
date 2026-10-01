> Historical record, retired by Spec #29. Source links resolve through the verified
> recovery baseline described in docs/history/pageindex-retirement.md. Commands
> and runtime behavior below are not current PageIndex instructions.

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

A syntactically invalid or malformed final answer may receive one Host-requested
format correction in the same Agent session. The correction disables all tools,
retains the existing evidence registry, and consumes the remaining Agent request
allowance and original run deadline. It adds no mandatory generation/review stage.
Every corrected answer still passes citation, scope and source-freshness checks;
unknown citations are rejected. `answerFormat` records the original format issue,
repair count and outcome. The internal correction instruction is retained in the
Agent trace and does not create another user-facing knowledge run.

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
configured SDK/chat/embedding transports use it. Eight owned HTTP requests may be
reserved/dispatched globally, with six available to background work. Interactive
waiters have priority. This is an HTTP capacity bound; the provider's unseen
computation count cannot be proved after a lost connection. The incident recovery
request explicitly changes the former indefinite uncertain-capacity policy; see
[ADR-0004](../../adr/0004-model-transport-capacity-and-outcome.md). The live issue's
stronger AC09 wording is not yet amended and is not claimed satisfied.

The logical deadline includes queue time and survives recovery. Provider JSON
calls honor configured timeouts, clipped by the logical deadline; admission does
not override them with a 45-second timer. Caller timeout/cancel detaches delivery
while the owner drains the response, bounded to five minutes from dispatch.
Capacity lasts until the physical response ends or local transport closes. EOF of
a non-streaming response, OpenAI `[DONE]`, or Anthropic `message_stop` settles the
request. Interrupted or unterminated streams remain uncertain after their HTTP
capacity is released. That uncertainty still blocks same-operation/input replay.
Queued-only attempts are not model executions. Maintenance attempts link to HTTP
request IDs; known pre-dispatch cancellation does not consume execution allowance.

Admitted Wiki/graph calls now keep their consumer attached until the persisted
maintenance deadline instead of abandoning an in-flight response at the shorter
provider request timeout. Each work unit still has 120 seconds within its existing
600-second operation budget; queue time and all attempts share those deadlines.
Explicit cancellation and ownership loss still detach immediately. Expiry records
`maintenance_deadline` and cannot publish a late result or reset budgets. This
maintenance-specific policy supersedes the per-request timeout behavior above;
interactive and standalone provider requests retain their configured timeouts.
The transport cleanup bound and eight/six HTTP admission limits are unchanged.

Owner heartbeats use lease/fence checks. Expired undispatched owners are fenced
before reservation reclamation. Lease expiry alone never reclaims dispatched
capacity: orphaned requests remain blocked until actual completion or audited
client process termination. Eight unreleased uncertainties (or six background)
fail affected admissions with `model_capacity_blocked`. Local transport termination
is not proof of remote termination or billing outcome. Host result deadlines and
transport settlement are separate; writer release waits for transport cleanup.

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
After local transport capacity has been released, actual provider
completion/termination evidence can reconcile the remaining uncertainty:

```sh
bun run model:status reconcile REQUEST_UUID provider-completed EVIDENCE_REFERENCE
```

For an owner process confirmed terminated, after its lease expires, release only
its HTTP capacity while retaining remote uncertainty and replay protection:

```sh
bun run model:status release-client REQUEST_UUID CLIENT_TERMINATION_EVIDENCE_REFERENCE
```

References are recorded durably. A timeout or expired lease alone is not client
process termination evidence. Status separates `active`, `draining`, `blocked`
(unreleased uncertain capacity), and `uncertain` (all unknown remote outcomes).
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
under the existing finite budgets. The real adapter assigns separate manifest
claims to the page title (`wiki-heading`) and section title
(`wiki-section-heading`), so both are independently reviewed.
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

Maintenance stores bounded model outputs in a `received` checkpoint before domain
validation. Recovery validates a compatible received result without dispatching
another request. Rejected outputs and `validation_issues` remain available through
authenticated maintenance diagnostics. Graph review distinguishes structural
errors from rejected support: structural repair receives specific feedback;
semantic rejection returns feedback to extraction before another independent
review. Extraction and review retain two actual requests each across retries and
recovery. A corrected extraction replaces its reusable cache only after review.
Unresolved Wiki source coverage and unsuccessful graph repair remain explicit
failures; these changes do not waive complete-coverage or publication checks.

Wiki review sends unsupported declared citations or unlisted prose back to draft
generation with the rejected response and specific issues. It does not repeatedly
review the unchanged candidate to obtain approval. Generation and review each
retain their existing three-request allowance. Migration 0037 adds the structured
validation diagnostics without rewriting prior attempts. The graph repair profile
is `graph-v5`; existing completed publications remain readable, and obsolete
in-flight profiles cannot silently publish under new rules.

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
