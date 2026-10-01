> Historical evaluation of the retired runtime. Source links resolve through
> docs/history/pageindex-retirement.md; these results do not certify Spec #29.

# Model admission incident recovery — 2026-09-13

The original eight-slot deadlock is reproduced, repaired, and recovered in the
same retained PostgreSQL authority, `loreweave_issue28_routes` in
`loreweave-issue28-test` at `127.0.0.1:45433`. This is a local incident-recovery
verification, not completion of issue 28's frozen semantic or production gates.
The prior [frozen failure evidence](../frozen-routes/stopped.json) is unchanged.

## Diagnosis

The old transport used a caller-aborted fetch and then retained every interrupted
request's uncertain capacity indefinitely. A local provider responding after
150 ms, with caller cancellation at 75 ms, reproduced the user's exact symptom:
provider completed, but `status.active` remained 1 instead of 0. The original
[red run](regression-before.log) is retained; the permanent regression is
[model-settlement.test.ts](../../../../tests/model-settlement.test.ts).

The retained attempt ledger establishes six background cutoffs at approximately
45 seconds. It does not establish six continuing remote computations:

| Request | Phase | Dispatch to local attempt completion (s) |
| --- | --- | ---: |
| addcffa0-d4eb-459d-b39a-8df467070310 | extraction | 45.009044 |
| aa10aac2-1fa6-4ace-a620-930033fbb31d | graph_extraction | 45.007627 |
| b47d4f19-bd39-4cdc-bc8d-1359cf15c2c8 | graph_review | 45.025769 |
| 9c05912b-6e4a-4c2f-8a61-e37944f6f096 | graph_extraction | 45.010938 |
| 4a2512eb-2285-4748-a388-2a97f25dd64d | extraction | 45.008859 |
| 2fb4451d-6e68-43a4-aa10-759acdd77bfd | extraction | 45.013602 |

Two interactive requests were cut off by their run deadlines; the last request
was dispatched with only 280 ms left. A configured 60-second JSON provider timeout
was previously ignored in favor of admission's 45-second hard limit. Short final
answer token limits also do not bound DeepSeek-V4 reasoning time. The
[provider research](../../../research/siliconflow-request-settlement.md) records
which cancellation/lookup/lifetime guarantees the public API does not supply.

## Changed invariant

[ADR-0004](../../../adr/0004-model-transport-capacity-and-outcome.md) deliberately
separates owned HTTP capacity from unknown remote outcomes. The limit is eight
owned HTTP requests, six background. It cannot establish an eight-computation
bound inside the provider after a lost connection. This changes issue 28's old
AC09 remote-outcome capacity wording; the remote issue has not been amended and
full specification acceptance is not claimed.

Caller deadlines detach delivery while the owner drains the response, bounded
to five minutes from dispatch. EOF/nonstream completion or protocol terminal
markers settle requests. Network failure or cleanup timeout ends the local
transport and releases HTTP capacity but keeps remote uncertainty and identical
operation/input replay protection. SiliconFlow trace IDs persist at headers.
Expired owner leases alone do not release dispatched capacity. Provider outcome
reconciliation cannot bypass a still-owned HTTP connection. Host deadlines remain
30/60 seconds and do not deliver late answers; execution/writer settlement waits
for admission and transport cleanup, including SDK disposal failures.

## Client termination evidence

The prior evaluator, PID 191700, was intentionally stopped by SIGINT during the
previous verification after all permits became uncertain. The stopped evaluation
and retained authority are recorded in the original failure artifact. Before
recovery in this session, process inspection found no evaluator, Bun application
backend or Vite process; PID 191700 no longer existed. All eight rows belonged to
owner `acfac337-5f3f-40d8-8929-18fad271f393`, whose lease ended at
`2026-09-13T13:27:49.322390Z`. The new application was started only after recovery.

This evidence establishes termination of the local owner and its connections.
It is **not** provider completion/termination evidence. Migration 0036 was applied
without deleting rows, then `releaseTerminatedClient` recorded this document's
reference for the eight requests. [Before](before.json): active 8, uncertain 8.
[After](after.json): active 0, blocked 0, uncertain 8. Their outcomes remain
`uncertain`, `settled_at` remains null, and `capacity_release.kind` is
`client-process-terminated`. No source/version/job deadline or retry allowance
was reset, and the old failure artifacts were not rewritten.

## Fresh real-provider evidence

All runs used the same retained authority and the configured
`api.siliconflow.cn/v1`, `deepseek-ai/DeepSeek-V4-Flash`, and BAAI/bge-m3 embeddings.
No provider/model change or unverified reasoning-parameter workaround was made.

- [Transport probe](real-transport.json): caller canceled at 157 ms; the owner
  received HTTP 200 and settled at 1,033 ms with trace
  `ti_bmj88kgg4dcwog47kb`. Active/blocked capacity returned to zero. The next
  request answered `2` at 779 ms (781 ms settled), trace
  `ti_aknr4p5uylivfpem5l`, with actual usage reported by the provider.
- [Public HTTP path](live-http.json): authenticated upload/import made the
  generated recovery source searchable using real embeddings. General answer
  completed in 3,130 ms; source retrieval and original-cited `7 天` answer in
  9,232 ms. These timings include 1-second client polling; both run snapshots
  report `answered` and `settledAt`.
- [Browser probe](browser.json), [screenshot](browser.png): actual login and
  submitted knowledge question returned the cited `7 天` answer in 11,468 ms;
  no page errors. Background maintenance was enabled during the HTTP/browser
  checks; this is evidence of coexistence, not a load/capacity benchmark.

After the final cleanup code was loaded by a graceful restart:

- [Shutdown snapshot](shutdown.json): active 0, blocked 0, draining 0, uncertain
  11. Three additional real background transports ended without a confirmed
  response; they retained uncertainty and released capacity, so they did not
  reproduce the permanent lock.
- [Post-restart failed browser request](failed-browser.json): one original-cited
  question failed `invalid_draft` and settled. The browser probe waited 65 seconds
  for an answer element; this is a test wait, not the model's execution latency.
  This negative result is retained, not replaced by subsequent successful runs.
- [Final running version](final-runtime.json): the subsequent general answer
  completed in 3,166 ms and original-cited answer in 8,953 ms. The same authority
  had active 2, blocked 0, uncertain 11; the active requests were background work.
  The source remained searchable; its Wiki and graph were `failed`. These stage
  failures have not been represented as successful recovery or silently reset.
- [Final browser reconnect](browser-final.json), [screenshot](browser-final.png):
  authenticated history survives the graceful restart with no page errors.
  The misleading static claim that all sessions use scripted models was replaced
  with wording valid for both real and scripted operation. This reconnect checks
  persisted answers and rendering, not a fresh model generation.

New background requests still sometimes exceed their consumer deadline or lose
a response. They now drain or release ended HTTP capacity while preserving the
uncertainty audit. Successful online questions do not establish Wiki/graph
publication quality, the original 96-case frozen evaluation, 15-second p95,
provider quota capacity, or production HA. Historical failed maintenance is not
silently retried with reset budgets.

## Software verification

The targeted real-HTTP/database suite covers cancellation before headers, streamed
cancellation, eight occupied connections followed by a ninth request, fragmented
terminal markers, unterminated SSE, cleanup timeout under backpressure, queue time
versus execution timeout, dead-owner recovery, same-input replay protection,
pre-dispatch close, close while draining, Host disposal failure, retirement write
failure, and persistent settlement failure. Three processes also share the actual
eight/six HTTP ceilings.

Commands use a separate disposable `loreweave_admission_debug` database:

```sh
TEST_DATABASE_URL=postgres://.../loreweave_admission_debug bun --no-env-file test tests/model-settlement.test.ts tests/model-admission.test.ts tests/model-concurrency.test.ts tests/providers.test.ts
TEST_DATABASE_URL=postgres://.../loreweave_admission_debug bun --no-env-file test tests/*.test.ts
bun run typecheck
bun run format:check
bun run check:docs
bun run check:vendor
bun run build
```

The focused run passed 29 tests. The final full software suite passed **266 tests,
0 failed, 1,861 assertions** in 317.49 seconds. Forge upstream regressions passed
**43 tests, 0 failed, 771 assertions**. Type checking, formatting, documentation
links, vendor provenance, build and whitespace checks passed. A final test-only
optional-signal typing correction received another focused settlement rerun.
Both review axes reported no remaining findings after correction and re-review.
[Check summary](checks.json) records the validation commands and boundaries. An earlier broad `bun test tests`
invocation incorrectly included three Playwright files in the Bun runner: its
262 Bun tests passed, but three runner-loading errors made that command fail.
A subsequent full run exposed an obsolete source-cache fixture that tried provider
reconciliation before local transport release. Its leaked fixture then blocked
later capacity tests. The fixture now separately records client termination and
provider evidence; 14 source-recovery/admission/concurrency tests passed after
that correction in a reset disposable database.
The corrected full command selects `tests/*.test.ts`; browser behavior is verified
separately through Playwright against the real application.
