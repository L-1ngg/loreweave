> Historical evaluation of the retired runtime. Source links resolve through
> docs/history/pageindex-retirement.md; these results do not certify Spec #29.

# Maintenance and direct-answer repair evidence

Date: 2026-09-13. Local changes based on `cc14703`, following
[issue 28](https://github.com/L-1ngg/loreweave/issues/28).

## Failure and resulting behavior

Wiki/graph maintenance previously detached from a still-running provider request
at the shorter chat timeout. A retry could then encounter `provider_uncertain`,
while the eventual HTTP 200 response was drained without domain validation.
Admitted maintenance now waits within its persisted work deadline. The existing
120-second work-unit and 600-second operation budgets, dispatch limits and
transport settlement rules still apply.

Bounded parsed maintenance responses are checkpointed before validation. Recovery
can validate a compatible `received` response without another dispatch. Rejected
responses retain structured validation issues. Structural review errors receive
format feedback; unsupported Wiki claims and graph relationships return to their
generation/extraction phase before independent review. Wiki retains three actual
generation/review requests each; graph retains two each. Unchanged rejected graph
candidates cannot gain approval by repeated review. Migration 0037 adds the
diagnostic field; graph processing uses `graph-v5`.

The real Wiki adapter now represents page and section headings as separate claims
without changing rendered Markdown. Previously the reviewer could identify a
section heading as unlisted prose, and draft regeneration could not correct that
host-generated heading.

A malformed direct answer now gets at most one format correction in the same
Agent session, with tools disabled and the original evidence registry, request
allowance and deadline. Citation, authorization and source-freshness checks still
apply. Unknown citations are rejected, and a second malformed result remains
`invalid_draft`. Run diagnostics record the format issue and repair outcome.

See the [implementation contract](../../design/rag-v1/issue-28-adoption.md).

## Controlled software verification

Run against isolated PostgreSQL databases using Bun 1.3.12:

```sh
TEST_DATABASE_URL=postgres://... bun --no-env-file test tests/*.test.ts
TEST_DATABASE_URL=postgres://... bun run test:browser
bun run typecheck
bun run format:check
bun run check:docs
bun run check:vendor
```

- Complete software suite: **276 passed, 0 failed**, 1,924 assertions across
  33 files, 328.61 seconds.
- Browser suite: **16 passed**, 34.1 seconds, including build, maintenance status,
  cited answers, cancellation and reload recovery.
- Typecheck, formatting, documentation links, vendor provenance and
  `git diff --check`: passed.
- The deadline regression initially exposed a race that reported the transport
  timeout instead of `maintenance_deadline`. After normalization, the three
  maintenance cases passed five repeated runs, followed by the complete suite.

Focused regressions exercise the actual boundaries:

- [Maintenance](../../../tests/maintenance-model.test.ts): a 650 ms HTTP response
  with a configured 40 ms request timeout succeeds exactly once; a 100 ms work
  deadline still fails without late publication and releases capacity; a received
  checkpoint resumes without dispatch even with its one-request allowance spent.
- [Direct answers](../../../tests/direct-answer.test.ts): replay the malformed
  preamble/quote pattern, correct once with tools disabled, reject a second format
  failure and unknown citations, and enforce the original deadline and source
  freshness during correction.
- [Graph](../../../tests/graph.test.ts): distinguish structural and semantic
  review rejection, feed rejection back to extraction and retain rejected output.
- [Wiki](../../../tests/wiki.test.ts) and
  [provider adapter](../../../tests/providers.test.ts): return unsupported declared
  citations to generation and independently represent both heading claims.

## Real-provider verification

The smoke uses the configured `deepseek-ai/DeepSeek-V4-Flash` chat model and
`BAAI/bge-m3` embeddings, the production `ModelAdmission` boundary and tokenizer,
and a generated source containing a 30-day log rule and an Alpha/Beta dependency.
Credentials were loaded into the process from local configuration and are absent
from these artifacts. Exact entity mentions are supplied by the smoke.

| Run | Wiki | Graph and cited answer | Evidence |
| --- | --- | --- | --- |
| Initial fix | Failed: declared citations did not all have reviewed support | Passed | [Smoke](real-smoke-initial.json), [rejected generation/review](initial-review-failure.json) |
| After Wiki feedback | Failed: heading representation caused unlisted prose feedback, followed by the work deadline | Passed | [Smoke](real-smoke-second.json), [heading rejection](second-review-failure.json) |
| Final fix | Ready; all maintenance jobs succeeded | Passed; one graph claim, cited 30-day answer | [Smoke](real-smoke-final.json), [durable diagnostics](final-maintenance-diagnostics.json) |

The final smoke reports `passed: true`. Its import operation dispatched 19 model
requests, all settled with HTTP 200 and released capacity. Fourteen maintenance
attempts include an initial source-coverage rejection and two structural review
rejections that recovered within existing allowances. Across all three smokes,
55 model requests settled with zero held capacity. Earlier failures are retained
as evidence rather than overwritten by the passing run.

The final real run's longest response start was 36.958 seconds; the deterministic
HTTP regression establishes behavior beyond the configured request timeout. The
final real answer did not require format repair; malformed-answer recovery is
verified by controlled replay. This small integration smoke does not establish
corpus-wide semantic quality, failure rate, latency or capacity acceptance.

All test databases were disposable. The original retained failure database and
its historical jobs were not modified or reset. No production service was
restarted and no remote change was published.
