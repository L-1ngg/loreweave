# Evaluation harness

Issue #17 supplies executable source-answer evaluation; #20 owns real maintenance
capture and #18 owns human/real-provider acceptance. Controlled fixtures establish
report correctness and scheduling only. No real quality, latency or capacity target
is certified by this harness.

Run against a disposable PostgreSQL database:

```sh
TEST_DATABASE_URL=postgres://... bun run test:evaluation
TEST_DATABASE_URL=postgres://... bun run eval:fixture /tmp/new-evaluation-output
```

The fixture creates an isolated organization, imports a separate Markdown original,
then queries the real authenticated HTTP answer interface with a read-only member.
It writes source manifests, development datasets and reports for a supported answer
and a provider returning the wrong numeric fact. The latter must fail the product's
support review and the evaluation. Missing Wiki/graph endpoints remain unavailable.
No question, reference answer, rubric, human label or generated answer is imported.

For a prepared corpus, use a session belonging to a member with only the `read`
grant. Set `LOREWEAVE_EVAL_TOKEN` in the process environment. The harness checks the
grant before answering, so benchmark instructions cannot execute knowledge edits.
Start each experimental runtime with `LOREWEAVE_RETRIEVAL_PROFILE` set to `source`,
`wiki`, `graph` or `combined`. All four include the original hybrid source baseline;
Wiki and graph are optional additions. An explicit graph experimental profile
attempts graph retrieval on every question. The ordinary development runtime keeps
its existing automatic relationship routing when the variable is absent.

```sh
bun run eval:run --manifest manifest.json --dataset development.json \
  --source http://127.0.0.1:41736 --output new-report.json
```

Add `--wiki`, `--graph`, `--combined` with independently configured HTTP endpoints
for the same frozen corpus. Runtime metadata is checked through `/api/runtime`;
model, policy, retrieval, context and common budget identifiers must match. Profile
mismatch or missing services yields unavailable cases with intact denominators.
The default runtime uses controlled models. Set up the explicit
[real-provider runtime](providers.md) before using these endpoints for real-model
acceptance; report provenance alone does not configure a provider. Reports never contain session credentials.

Schemas are versioned in `src/evaluation/schema.ts`: the source manifest records
immutable version IDs, SHA256 of exact decoded text, project scope, parser and
embedding profiles. Each question records complexity, evidence-condition category,
reviewed original references, required points, expected gaps, diagnostic tags and
a paraphrase group. Hashes use SHA256 of `JSON.stringify` of schema-normalized
objects. The fixture output is an executable format example.

Prepare 50 development questions (40 ordinary/10 complex). Separately prepare
200 acceptance questions (160/40), including sufficient, missing and conflicting
source evidence according to the evaluation plan. Human reviewers must check
references and manually group paraphrases before freezing. The runner rejects
unreviewed references, exact normalized question overlap and shared paraphrase
groups; semantic overlap beyond that still requires the human preparation pass.
Acceptance mode requires a frozen timestamp, the development dataset hash and
`--development development.json`. There is no acceptance tuning or ingestion API.

Every submitted case remains in its category denominator, including errors,
timeouts, partial answers and missing routes. Reports retain raw retrieved evidence,
answers, certificates, actual locator/text/current-version/scope checks, exact
reference recall (a diagnostic, not the final correctness criterion), completion,
queue/retrieval/generation/review timing, model and embedding request counts.
Delivery latency ends before evaluator citation/grade reads. Provider token usage
and monetary cost currently remain unavailable, not fabricated zeros. Maintenance
adapter records have explicit availability, versions and numerator/denominator;
source-only runs cannot claim maintenance metrics.

Fixture mode uses a labelled deterministic oracle. Human mode always leaves viable
answers pending independent review; product support review is not a human score.
Create a grades file matching `humanGradesSchema` in `src/evaluation/grading.ts`,
with the exact report hash, case/profile identity, reviewer/time and separate
correctness, completeness, citation support and gap/conflict judgments. Apply it
without modifying the original report:

```sh
bun run eval:grade report.json human-grades.json new-graded-report.json
```

Human grading may accept equivalent valid original evidence beyond the suggested
reference locators. It cannot turn broken citations, failed requests or unavailable
routes into passes. Record disagreements and resolution in review notes. Reports
and grades are artifacts outside the knowledge corpus; output paths must be new.

## Maintenance capture

Issue #20 connects seven diagnostic adapters to actual authenticated operation,
Wiki, identity and graph HTTP reads. Run the bounded integration fixture on a
disposable database, or capture an existing operation without changing knowledge:

```sh
TEST_DATABASE_URL=postgres://... bun run eval:maintenance-fixture /tmp/new-maintenance.json
TEST_DATABASE_URL=postgres://... bun run test:maintenance-evaluation
LOREWEAVE_EVAL_PROVENANCE=controlled-provider bun run eval:maintenance \
  http://127.0.0.1:41736 OPERATION_ID new-maintenance.json routing-targets.json
```

The last command also requires `LOREWEAVE_EVAL_TOKEN` with only the `read` grant;
use `real-provider` provenance only for a runtime that actually uses real models.
Routing targets are optional and never become model or ingestion input. Human
runs require human-reviewed targets. Use `jobId:topic:0` to identify a decision
unambiguously; `topic:0` alone is accepted only when exactly one job matches.
Missing/ambiguous decisions remain in the target coverage and recall denominators.
False-creation and missed-reuse rates cover matched decisions only, so inspect
target coverage with those rates. A zero denominator means no observations.

Each capture retains the actual candidate pool, per-route ranks, exclusions,
catalogue revisions and pinned policy/index/model profiles. Recall@8/@16 counts
reference page hits over all reviewed reference pages. Mandatory coverage counts
completed dependency walks over all registered required walks, including those
not yet started. Discovery uses the full root source obligation, including ranges
without a child ledger; absent root manifests remain unavailable. Source-packet
ledgers retain intermediate progress and exact unresolved obligations. Detail inspection counts completed versioned ranges per
logical decision, with remaining ranges and terminal job reasons retained. These
are coverage records, not proof of model routing quality.

Lifecycle events are written in the publication transaction and attributed to
that operation. Retirement/reactivation, failed refresh and historical page state
are separate fields. Events before this migration are not reconstructed. Identity
records expose actual proof validity, current/historical revisions and durable
reconciliation batches. Graph records retain packet review/exclusion outcomes,
generation profiles, source versions and replacement membership. The API adapter
can additionally inspect specified mention and entity IDs for current proof and
neighborhood support; operation-only captures do not claim that wider inspection.

Work records distinguish budget admission, dispatch intent and completed validated
responses. A durable dispatch timestamp precedes the external request; a crash or
abort in that gap cannot prove the provider received it. Exact provider requests
are therefore unavailable when dispatches have uncertain outcomes or historical
telemetry is absent. Completed responses provide a lower bound; dispatch intents
provide an upper bound for recorded attempts. Repeated requests with the same
job/unit/phase/input hash are retries; different inspection windows are separate
work. Generation/review phase and outcome remain available per request. Tokens
and price are unavailable until the provider adapter supplies that telemetry.

Source-searchable/Wiki-ready/graph-ready durations run from operation acceptance
to the latest required successful receipt, including queue time. Failed, pending,
outcome-unknown or superseded work cannot establish readiness. Retirement can
successfully finish maintenance while producing no active prose; consult the
separate lifecycle disposition. Later source changes may invalidate old readiness;
the times describe completion of that operation, not present evidence eligibility.

The controlled fixture imports its own originals and executes real maintenance:
source replacement, retirement and revival of one stable topic, alternate graph
support and empty replacement, immediate identity-proof invalidation followed by
reconciliation, failed partial graph extraction, and six-window inspection
termination with unresolved ranges, and source-extraction failure after the first
packet. Pending dependency walks remain in the denominator. Reports contain public diagnostics and exact
fixture inputs, not manually authored expected diagnostic records. This verifies
reporting and finite scheduling; #18 still owns human/real-provider acceptance.
