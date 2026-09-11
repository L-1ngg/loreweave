# Maintenance recovery

Issue #16 keeps operation outcome, execution settlement and derived readiness
separate. Source imports display source, Wiki and graph progress independently;
`/operations/<operation-id>` shows durable job outcomes, reasons, model admissions
and committed receipts. Administrators can inspect unknown outcomes with
`POST /api/operations/<id>/reconcile`; readers can only inspect status.

Every new job commit writes a receipt keyed by job and worker fence in the same
transaction as the domain effect. A retry checks this receipt before dispatch and
a lost transaction acknowledgement checks it again before reporting failure.
Reconciliation locks an `outcome_unknown` job, inspects its exact receipt, and
restores the known state or queues a transaction with no committed receipt.
Existing terminal jobs are backfilled on migration. Unknown outcomes inherited
from before the receipt migration remain `needs_attention:legacy_unknown` rather
than assuming the old runtime wrote a receipt. No operation payload or logical
model budget is reset by reconciliation. Active or expired running jobs continue
to use the existing lease/fence protocol; an obsolete worker cannot commit.

Graph generation identity is the durable trigger job plus source/profile and
identity input snapshot. Replacement workers resume its packet manifest, cached
extraction/review outcomes and original deadlines. Endpoint proof bindings are
registered before identity resolution, including exclusion-only references to other
sources; valid proof bindings are recorded before review and rechecked under
publication locks. Repeated crashed
review calls consume the same two-attempt allowance. Exhausted/incomplete work is
visible as a failed generation; only a fully reviewed generation can activate.
A compact organization revision count/sum detects identity events consumed before
new endpoints are discovered. A changed input supersedes the generation and permits
one automatic replacement; repeated churn remains visible as needs_attention.
Identity change events accept single mentions and durable batches, enqueueing
separate stable source replacement jobs. Empty replacement retires this source's
memberships while preserving alternate support and historical memberships.

Original packet spans use UTF-8 byte ceilings and exact UTF-16 offsets, preserving
Chinese and non-BMP text without the old characters-divided-by-four estimate.
Boundary bridges contain both adjacent original spans. Explicit Markdown fragment
links schedule bounded bridges to the actual target section; unresolved anchors
and overflow leave visible incomplete coverage. The generation profile pins the
model, packet, vocabulary and normalization versions. Graph traversal uses
current source memberships and valid identity proofs, returns at most two hops,
50 entities and 100 claims, and exposes truncation/coverage gaps. Unknown status
qualifiers stay unknown. Batched graph support lookup returns authoritative
original document metadata, so citations can pass the same evidence validation
as source/Wiki retrieval.

Wiki dependency and discovery cursors, inspection windows, proposal ledgers and
model budgets keep their existing durable owners. Verification replaces Wiki
workers between 20/20/5 mandatory-page batches, discovery continuation, retirement
and revival, and drops real PostgreSQL COMMIT acknowledgements after graph/Wiki
publication. Fresh workers and public status/evidence verify the receipt, current
version and support membership without replay. Lost connections also have a
bounded five-second pool shutdown fallback. Existing source/catalogue publication races and identity proof-walk
restart checks remain in their module suites.

Run root `test:operations`, `test:graph`, `test:identity`, `test:wiki`,
`test:wiki-refresh`, `test:wiki-history`, `test:persistence` and `test:browser`
against disposable PostgreSQL. The graph worker fixture really exits between
persisted extraction and review; only its dead lease is advanced in the test
database to avoid a two-minute wait. Use a separate disposable database for
browser workers so intentionally unfinished module-test jobs do not starve them. Controlled providers prove scheduling and
failure behavior, not relation extraction quality or a refresh SLA.
