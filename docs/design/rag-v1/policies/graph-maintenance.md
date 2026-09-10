# Graph extraction generations and coverage

Status: design defaults selected on 2026-09-10. M04 owns graph construction;
M03 owns identity proofs, M02 source versions, and M08 durable work. Query-time
limits of two hops/50 entities/100 claims are independent of construction limits.

## G01: Source packets and extraction

An extraction generation is identified by source version and a pinned processing
profile (model, prompt, relation vocabulary, packet policy and normalization
versions), plus its identity-input revision snapshot and durable trigger ID. A
new identity revision creates a replacement generation even if source/profile
are unchanged; a retry of the same trigger resumes the same generation. Build a deterministic packet manifest covering all source passages.
Each packet has at most 3,000 primary original tokens plus 1,000 context tokens
from headings, adjacent text, table headers or explicit same-document references.
Preserve original locators and split oversized structures without losing their
headers or continuation identity. Context duplicates do not become new evidence.

Resolve references spanning packets by scheduling a bridge packet containing the
actual relevant original spans, at most 4,000 tokens. At most two bridge packets
may be requested per primary packet, identified and deduplicated by their source
locator sets. Missing/unresolvable context or bridge overflow is recorded as
incomplete coverage, not fabricated linkage. Cross-document navigation combines
independently supported claims via valid M03 identities; it does not materialize
an inferred relationship as a new source fact.

For each primary/bridge packet, extract at most 20 proposed relationships with
subject/object mention references, predicate/direction, original relation wording,
supporting spans, scope, time/environment, negation, plan/current/history status
and conditions. If more are needed, report overflow and leave that packet
incomplete; the limit cannot silently turn partial extraction into full coverage.
A later explicit reprocessing request may select a revised profile/packet size.

Resolve mentions through M03. Reliable explicit identifiers/equivalence can bind
endpoints; unresolved endpoints stay staged and non-traversable. A packet scanned
successfully can record unresolved identities as explicit coverage exclusions;
identity reconciliation schedules generation replacement when they resolve.

## G02: Normalization, identity and semantic checks

Use the versioned small relation vocabulary from M04. Unsupported predicates remain
original evidence with a diagnostic exclusion; never force them into a wrong type.
Normalize direction only through a declared predicate mapping. Preserve unknown
qualifiers and original wording. Parse explicit dates with source context; do not
use upload time as the effective time or infer a positive edge from negation/plans.

The canonical claim fingerprint includes trusted scope, bound endpoints, predicate,
direction and normalized qualifiers (including retained normalized condition text).
Different applicability, negation or conflicting assertions produce separate claims.
Source-support identity additionally includes source version and original locator
set. Merge identical fingerprints while unioning distinct support references;
deduplicate overlapping packet evidence. Keep raw mention bindings/proof revisions
on each support record so an invalid equivalence cannot survive via the fingerprint.
Equivalent paraphrases not proven equivalent remain separate claims with diagnostics.

Run deterministic schema/reference checks and the supported/contradicted/insufficient
review from the [evidence policy](evidence-validation.md#v01-claim-manifest-and-support-review).
Audit source wording, direction and qualifiers, not merely the existence of a quote.
Each packet has at most two extraction-generation requests and two review requests,
four LLM calls total including retries, a 120-second deadline from claim and a
45-second request timeout. A revised output requires a remaining review slot.
Persist counters across retries. M03 mention-resolution work has its own I02
limits; include those calls in total maintenance cost/admission rather than hiding
them in the four extraction/review calls. Unreviewed, contradicted or insufficiently supported
claims remain ineligible. A malformed response, output overflow or missing required
context leaves coverage incomplete; declared unsupported-vocabulary/unresolved-ID
exclusions are visible and are never presented as proof that no relationship exists.

## G03: Staging and atomic generation replacement

Persist packet outcomes, staged claims/support and a coverage manifest: scanned,
scanned-with-exclusions, incomplete or failed. Every primary and requested bridge
packet must reach a reviewed scanned outcome before the generation can activate;
zero relationships can be a successful scanned outcome. Coverage means the input
was processed under this profile, not proof the model discovered every true relation.

Atomically change the source's active graph-generation pointer after checking
packet completeness, current source version, endpoint proof validity and worker
fencing. Derived queries only use published generation memberships and currently
valid supports. A failed new generation cannot expose half its staged claims.
For explicit reprocessing of the same source version, keep the old valid generation
until replacement succeeds. When the original source itself changes, old supports
are already ineligible under C02 even if replacement extraction is incomplete.

Replacement retires the previous generation's support memberships, rather than
blindly appending new edges. Keep historical claims/provenance; a claim with valid
support in another source's active generation remains traversable. Empty replacement
retires all supports belonging to that source without deleting other sources' facts.
An unresolved endpoint exclusion remains visible as limited graph coverage and can
be retried after M03 reconciliation. Wiki readiness does not depend on graph success.

An uncertain publication is inspected by durable operation/generation key before
retrying. An obsolete source generation is superseded, not reactivated. Use stable
packet cursors and separate source/identity-trigger identities; duplicate events
cannot create duplicate generation memberships or restart budgets. M08's single
background model slot applies. No graph-refresh SLA is claimed.

## G04: Verification and delivery

#12 implements packets, normalization, review, staged publication and replacement;
#8 supplies proof validity, #13 consumes coverage in answers, and #16 verifies
recovery. Exercise long documents, a relation across adjacent sections, unavailable
bridge context, output overflow, negated/planned relations, conflicting qualifiers,
overlapping packets, no-edge sources, unresolved identity, empty replacement, a
failed halfway extraction and another source retaining independent support.

#20 integrates generation/packet coverage, exclusions and review diagnostics into
the evaluation harness; #18 checks model quality and source-update behavior on
reviewed examples. Scripted tests establish scheduling and admission behavior;
human comparison against original sources establishes extraction-quality evidence.
