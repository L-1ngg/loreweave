# Shared construction contracts

These contracts implement the confirmed goals and delegated design choices.
Interface names are design vocabulary, not existing exports. Transport DTOs and
database schemas may differ internally while preserving these meanings.

## C01: Identity and trusted context

Every operation has a trusted actor, organization, grants and resolved project
scope supplied by M01. Model arguments cannot override them. Stable IDs identify
documents, source versions, passages, entities, entity-resolution revisions,
pages, page versions, edit sets, sessions, runs and operations independently of
titles/filenames. Opaque IDs are not required user input.

Distinguish organizational visibility from retrieval relevance. A scoped question
can include relevant shared organizational sources. Cross-project entity identity
does not authorize silently expanding a project-specific question's scope.

## C02: Source and dependency validity

A source reference identifies an immutable source version and a passage locator
with original text. An evidence item also records the conditions under which it
supports the claim. Version-specific references remain resolvable historically.
Source activation and real-world rule applicability are separate: activating one
document revision does not supersede a different source by upload time alone.

M02 owns current document pointers. M03 owns entity-resolution revisions. Wiki
and graph carry dependency manifests of both. Consumers ask the owners to
validate these dependencies; M06 is the final answer admission point. Workers'
cached `ready` labels cannot override authoritative pointer checks.

First-version invalidation uses source-version granularity. A page with changed
dependencies may be bypassed as a whole until revalidated; unaffected pages
remain available. Claims with separately valid support can remain eligible via
that support. No unimplemented sentence-level dependency algorithm is assumed.

Entity validity includes the transitive source leaves of the identity proof,
not just an unchanged identity revision. M03 exposes proof-closure validation;
M02 activation atomically registers revalidation work. Consumers reject obsolete
bindings before that work runs. See [I01–I03](policies/identity-provenance.md).

## C03: Model and domain execution

Forge owns its execution loop. M07 owns the host run and shared budget. M02/M05
and other domain modules own their actual changes. M08 deduplicates requests and
coordinates leased work; it does not interpret model intentions or own all domain
tables. A command retry with the same operation key and same payload returns its
known outcome; the same key with different payload is rejected.

Store an operation's accepted request and its durable job atomically. Store
committed domain changes with their operation outcome/next work transactionally.
After an uncertain commit, inspect by key before retrying. An SDK tool-result
write is a separate transaction; its absence never proves that the domain effect
did not occur. Correlate tool calls with operation IDs for recovery.

## C04: Three independent lifecycles

| Object | Observable states | Completion meaning |
| --- | --- | --- |
| Source revision | preparing, ready, active, superseded, failed | `active` means prepared original evidence is eligible for current retrieval |
| Maintenance operation | queued, running, retry_wait, succeeded, failed, outcome_unknown, superseded | Domain outcome is durable; Wiki/graph readiness remains individually visible |
| User run | queued, executing, finalizing, refreshing, answered, partial, needs_clarification, failed, timed_out, canceled | Product outcome returned; execution settlement is tracked separately |

Record `settled_at` only when SDK consumption, started persistence and tool
cleanup have finished. A timed-out or canceled run may still be settling. It
keeps its execution slot/lease until cleanup or confirmed process termination;
otherwise nominal five-way concurrency could hide unlimited unfinished work.
An accepted maintenance job can continue after the conversational run ends.

## C05: Budgets and finalization

One absolute deadline includes queueing, model calls, tools, retries, summaries,
evidence refresh, final generation, semantic review and delivery. Hard limits are
30 seconds ordinary and 60 seconds complex; ordinary p95 target remains 15 seconds.
Reserve 8/15 seconds for finalization; retrieval has at most 2/3 rounds.

Allow at most three exploration model requests, two final-generation requests and
two semantic-review requests: seven total, with four reserved finalization slots.
Normal grounded finalization uses one generation and one separate tools-disabled
review. Retries consume their phase's slots. Remaining generation/review capacity
can repair a draft OR handle a source refresh; it is not an additional allowance.
Deterministic receipts/clarifications need no model finalization. M06 owns this
pipeline; Forge exploration text is not a final product answer.

Every request acquires atomic admission before dispatch, including SDK retries
and summaries. Use an internal budget seam/patch if needed. Follow
[V01–V04](policies/evidence-validation.md) for claim manifests, original-support
review, certificates, partial answers and exact phase transitions.

The sole finalization retrieval exception is one host-controlled `refreshing`
phase using an unused original retrieval round. It cannot restart Forge exploration
or perform writes. Supersede the old draft; regeneration and review consume the
same remaining slots and deadline. A second source change or insufficient budget
returns a still-valid reviewed subset or an explicit gap. Freeze evidence IDs and
`validated_at` after final eligibility checks; this is point-in-time validation,
not a guarantee against changes during network delivery. Added review latency is
an implementation measurement obligation, not proof the timing target is met.

## C06: Errors and partial outcomes

Use explicit outcomes: unauthorized, ambiguous_target, not_found, invalid_input,
version_conflict, insufficient_evidence, budget_exhausted, unavailable,
operation_pending and outcome_unknown, with safe structured details. Distinguish
missing original evidence from unavailable/stale graph or Wiki coverage.
Failure to find a graph edge does not establish a negative fact.

Do not publish a generated answer with dangling citations, failed semantic support
review, or claims whose support became invalid. Real citations alone do not prove
that the cited text supports the assertion; review failure cannot bypass V01.
A supported partial answer may be returned but fails
complete-answer evaluation when the corpus contained the missing information.
Retrieval diagnostics and SDK success status cannot substitute for this rule.

## C07: Publication and recovery

M05 owns publication of related page edits as one edit set. Check expected page,
source and identity revisions inside the publication transaction. Complete source
activation never waits for a Wiki/graph publication transaction. A late worker
with an expired fence cannot overwrite newer publication. Merge/split restoration
creates a new edit set preserving later unrelated edits, historical references
and the user's retained correction intent.

Topic creation/merge/split also validates the relevant M05 catalogue revisions
and reservation ownership in the publication transaction. Concurrent catalogue
changes require fresh selection, not blind retry of a stale create instruction;
the [topic maintenance policy](policies/wiki-topic-maintenance.md) owns the rules.

A Wiki page with no remaining support can retire successfully while preserving
history under [P08](policies/wiki-topic-maintenance.md#p08-retirement-when-current-support-disappears).
Graph extraction stages complete generations and atomically replaces support
membership under [G03](policies/graph-maintenance.md); partial staging is not ready.

## C08: Test seams

Use the highest applicable public interface: authenticated browser/HTTP/MCP flows
for product acceptance; module commands/queries with real PostgreSQL for source
activation, leases and atomic publication; Forge host with a scripted local
provider for request admission, cancellation and persistence ordering. Pure
parsing/qualification tests are appropriate where the behavior is independently
meaningful. Avoid testing private call sequences or comparing generated prose
to one literal answer string.

SDK internals, model adapters and database drivers remain behind the host/module
interfaces. If a local Forge patch is required, test its request-admission seam
with actual provider request counts and side-effect logs. Those focused tests
complement rather than replace the product outcome tests.
