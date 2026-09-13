# Issue 28 implementation evidence

The application implements direct Agent answers, explicit evidence routes, durable
HTTP admission and resumable incremental preparation. This record distinguishes
software behavior from real-model quality and deployment acceptance. The adopted
runtime contract is [issue-28-adoption.md](../../design/rag-v1/issue-28-adoption.md).
No remote issue closure or production acceptance is implied.

## Software verification

Tests used Bun 1.3.12 and disposable PostgreSQL 17 databases with
`pgvector/pgvector:0.8.2-pg17`. Controlled providers exercise actual PostgreSQL,
HTTP streams and process replacement. These checks do not measure model quality.

| Verification | Evidence |
| --- | --- |
| All root software tests | `bun --no-env-file test ./tests/*.test.ts`: 250 passed, 0 failed, 1,766 assertions. Later review fixes receive focused reruns below. |
| Final review regression reruns | Host/HTTP/persistence/evaluation/capacity: 49 passed; Wiki/evidence: 42 passed; Graph: 25 passed. These cover changes after the all-root run. |
| Browser behavior | `bun run test:browser`: 16 passed, including import readiness, source replacement, citations, corrections and Wiki history. Browser jobs use a separate clean database from failure fixtures. |
| Vendored Forge regression | `bun run test:upstream`: 43 passed, 0 failed, 771 assertions. |
| Actual HTTP admission across processes | Three independent Bun processes share one PostgreSQL authority. Mixed chat/embedding HTTP streams reached peak 8 total / 6 background; all completed and capacity returned to zero. |
| Persistence and ownership | Reload/reconnect, changed source rejection, pending result writes, cancellation and durable settlement remain covered. |
| Recovery and reuse | Killed source worker, exact embedding cache recovery, unknown remote results, queued duplicate suppression, index catch-up and rollback have controlled regressions. |
| Wiki section work | Two independent sections overlap, continuations preserve order, failed review waits for started work and cannot publish partial content. Historical merge/split/restore remain covered. |

The initial broad `bun test tests` invocation also collected Playwright files with
the wrong runner. Its errors are not counted as browser verification; the explicit
root test selection and separate Playwright invocation above are authoritative.
The initial browser invocation against the module-test database consumed failure
fixtures. A clean browser database resolved that interference; CI already isolates
these databases.

## Real-provider development evidence

The two six-case development runs use the same frozen synthetic corpus/questions:

- [v2 frozen inputs](direct-development-v2/frozen-inputs.json) and
  [v2 results](direct-development-v2/results.json).
- [v3 frozen inputs](direct-development-v3/frozen-inputs.json),
  [v3 results](direct-development-v3/results.json), and
  [mixed-answer parsing failure](direct-development-v3/failure-diagnostics.json).
- [Independent agent development scoring](development-scoring.md), including
  per-case semantic defects, citation support, routing limits and small-sample p95.

V3 delivered 5/6 answers; the mixed answer still emitted invalid JSON. Citation
traceability did not catch semantic overstatement or incomplete citation coverage.
The parser permits literal control-character normalization and adds omitted
markers for declared valid handles, but never guesses unescaped quote boundaries
or invents citation handles. Invalid JSON remains a rejected answer.

[The frozen four-route comparison](frozen-routes/execution.json) reuses issue #25's
20-document corpus and 24 questions (96 intended answers). It measures fixed
source, source+Wiki, source+graph and combined configurations, not unconstrained
Agent route-selection quality. The six-case experiment and this comparison are
separate evidence. The frozen process began before the final review fixes for
Wiki fallback ordering/readiness, graph relevance ordering and Host failure reason
classification; it is evidence of that development revision, not a fresh run of
those final changes.


The comparison stopped after **17 completed cases: 4 delivered answers and 13
without delivery**. The remaining 79 cases were not completed and are not counted
as model failures or latency observations. Six background and two interactive
requests became uncertain, occupying all eight permits. Later cases had zero
HTTP dispatches and expired in the queue. This is a partial negative result, not
a completed four-route comparison or an accepted quality/latency result.

- [Frozen partial report](frozen-routes/report.partial.json),
  [maintenance readiness](frozen-routes/maintenance.json), and
  [independent scoring](frozen-routes/scoring.md).
- [Stop record](frozen-routes/stopped.json) and
  [request ledger at stop](frozen-routes/transport-at-stop.json).
- Retained local authority: database `loreweave_issue28_routes` in container
  `loreweave-issue28-test`, PostgreSQL port `45433`. The evaluator process stopped;
  the database and all uncertain permits remain intact. No remote-completion
  evidence was available and no permit was reconciled.

In that development revision, `timed_out / budget_exhausted` also represented an
Agent call-count limit. It must not be read as proof of a 30/60-second wall-clock
timeout. Final Host behavior reports `failed / model_call_budget_exhausted` for
that case and `failed / agent_execution_failed` for an unsuccessful provider turn;
actual deadline expiry retains `timed_out`.

## Remaining acceptance boundaries

The formal issue #18 gate still requires the intended hardware/provider quotas,
1,000 documents, 20 million characters, five concurrent interactive requests,
backlog drainage and recovery measurements. No production p95, throughput, RPO,
RTO, failover or exactly-once billing guarantee follows from software tests.

The real-provider cold-maintenance run encountered remote outcome uncertainty.
Such permits stay quarantined until actual provider completion/termination
information is available; no elapsed-time-based reconciliation is performed.
Wiki/graph quality improvements cannot be established when those projections are
not ready. A complete independently scored cold/no-op/local-edit/deletion/context/
identity-change maintenance comparison and deployment recovery evidence remain
acceptance work. Current software regressions establish the reuse, invalidation,
coverage and publication mechanics without asserting that lower model-call counts
prove better semantic coverage.
