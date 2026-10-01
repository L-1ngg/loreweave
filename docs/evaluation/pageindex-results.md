# Measured PageIndex replacement evaluation

Final local evaluation, 2026-10-01, for [Spec #29](https://github.com/L-1ngg/loreweave/issues/29)
and [#47](https://github.com/L-1ngg/loreweave/issues/47). The TypeScript application,
both modes and actual Web/MCP questions have executable evidence. The
[AC01–AC35 matrix](pageindex-acceptance.md) records the verification boundary.
These fixed synthetic originals and implementation-agent support review do not
establish general financial/legal/scientific accuracy.

## Corpus, execution and result selection

Frozen bytes/provenance are in the [12-PDF manifest](../../tests/fixtures/pdf/manifest.json),
[two additional sources](../../tests/fixtures/pdf/question-manifest.json),
[20-page derivative](../../tests/fixtures/pdf/boundary-manifest.json) and
[11 fixed questions](../../tests/fixtures/questions.json). SHA-256 identities,
generator transformations and Noto Sans SC license/font identity are recorded.
These project-generated originals cover columns, CJK, rotation, bookmarks, TOC
offsets, continuous prose, large sections, 20/21-page policy and unsupported inputs.

TS trials use compiled Start/Bun 1.3.12, public HTTP/server functions, real
PostgreSQL 17 and official MCP client 2.0.0. Actual authorized `gpt-6.1-sol` calls
use the maintained TanStack OpenAI Chat Completions adapter and
`https://hiopenai.cc/v1`. Index/QA role verification exercised tools, streaming
and structured outputs. Model identity is provider-declared; no separate direct
`api.openai.com` credential was supplied.

The clean Python comparator is pinned to
`d2693d80791a86345ef78b3234834f5fe53a70a0`. Full Flash optimization/summaries and
independent Standard construction/subdivision/summaries ran for all 15 inputs.
Versions/settings are in [the full reference](pageindex-full-reference.json).
It initially lacked PyCryptodome; [the encrypted-only recheck](pageindex-encrypted-reference.json)
adds pinned 3.23.0 and confirms `FileNotDecryptedError` in both modes with zero
model calls. Initial dependency failures remain recorded. Python never enters
the application runtime or its startup dependencies.

[Paired comparison](pageindex-paired-comparison.json) selects the latest explicit
result in this order: [full TS trial](pageindex-real.json),
[targeted regression](pageindex-real-regression.json),
[earlier large retry](pageindex-large-retry.json), [final large trial](pageindex-large-final.json).
Every earlier failure/unavailable question remains in `candidateTrials` and raw
reports. This cohort is not one uninterrupted first-pass success.

## Import, extraction and navigation

| Measurement | TS Flash | TS Standard | Python Flash | Python Standard |
| --- | ---: | ---: | ---: | ---: |
| Attempted inputs including rejections | 15 | 15 | 15 | 15 |
| Latest ready/completed | 11 | 12 | 10 | 10 |
| Accepted TS trees with full physical coverage, valid ranges and every-node summaries | 11/11 | 12/12 | — | — |
| Accepted original reachability checks for shared questions | 13/13 | 13/13 | 13/13 | 13/13 |
| Successful index median | 34.157 s | 19.571 s | 0.078 s | 120.557 s |
| Successful index p95/max | 88.217 s | 146.309 s | 29.593 s | 210.185 s |

TS Flash rejects `inadequate.pdf` for insufficient structure. Both TS modes
explicitly refuse scanned/encrypted originals and fail the malformed original.
Standard accepts all 12 readable inputs in the selected cohort. No automatic
mode/provider switch was introduced. Python Flash additionally rejects
`large-section.pdf`; Python Standard fails that and `inadequate.pdf` with
`Processing failed` at its no-TOC verification gate. Those measured failures
remain pairs and stay in coverage. These counts do not establish general TS superiority.

All 12 mutually extracted inputs preserve the same non-whitespace character
multiset on every corresponding physical page. Two have identical normalized
order; ten differ. TS uses geometric column ordering; PyPDF2 content-stream order
is a recorded difference. Fixture-authored two-column order, exact Chinese
qualification, rotated text, printed labels and verified/unverified outlines
pass separate extraction tests. Original factual text retains recurring margins;
navigation input removes them.

Exact IDs/tree shape are not parity gates. TS can keep roots, fuse verified
bookmarks, merge, subdivide and share boundary pages; Python sometimes retains
short per-page trees. Every pair retains title/location/depth differences.
Accepted TS indexes require source-backed anchors, revision-local identity,
valid inclusive bounds, complete coverage and default summaries. Rejected raw
reference trees are inspected but cannot satisfy original reachability.

The final Standard large trial first failed on gateway overload. One explicit
public `retryOperation` completed with the same operation/document/version,
validated extraction reuse and both attempts retained. Duplicate retry submission
returned the same attempt with `created:false`. Total 146.309 s includes the
failed attempt; success alone took 78.943 s and 11 model calls. Earlier anchor,
truncation and overload failures remain recorded.

A measured parent-summary defect was corrected by retaining child/fragment
bounds and prohibiting page-specific inferences from shared navigation ranges.
The targeted `no-toc` tree distinguishes its overlapping boundary from factual
locations. The latest large Standard summaries preserve 2026/2025 physical-page,
currency, subsidiary and audit qualifications. Review is in
[the semantic record](pageindex-semantic-review.md). Schema/range validity
does not guarantee arbitrary summary entailment; answers require original reads.

## Answers, citations and lifecycle

| Latest selected measurement | Flash | Standard |
| --- | ---: | ---: |
| Web fixed questions completed | 11/11 | 11/11 |
| Independent official-client MCP QA completed | 1/1 | 1/1 |
| Web factual answers / evidence gaps / clarifications | 9 / 1 / 1 | 9 / 1 / 1 |
| Web model / tool calls | 35 / 30 | 33 / 29 |
| Web page-read records | 35 | 44 |
| Web provider input / output tokens | 109,308 / 4,270 | 103,607 / 4,223 |
| Web median / p95 latency | 27.395 / 48.132 s | 22.191 / 63.094 s |
| MCP model / tool calls | 3 / 2 | 3 / 2 |
| MCP latency | 18.400 s | 18.200 s |

[Original-evidence review](pageindex-semantic-review.md) inspected all 24 selected
outcomes, including 20 factual answers. They preserve company/year/currency/scope,
exclusions, arithmetic and unresolved source conflicts, with claim-adjacent
original support. Missing employee disclosure produces an evidence gap;
unspecified annual report produces clarification. Flash follow-up scope wording
has a documented caveat. This is an agent review, not blind independent scoring.

Both latest revenue answers fail the literal substring check because
`USD 120 million`/`US$120 million` differs from `120 million USD`; original review
establishes equivalence. Lexical checks remain exposed and are not semantic scores.
Server run/scope/version/page/reference validity is a separate tested contract
and cannot establish claim entailment by itself.

Real reader cancellation, browser reload/navigation/closure in both modes left
accepted work running to completion. Duplicate acceptance/reattachment added
zero model calls. Stop settled locally in 59/61 ms and the proxy observed
transport abort. Actual SIGKILL/restart marked work interrupted, retained
committed history and replayed zero calls. Remote computation/zero further billing
is unobservable. Controlled scenarios additionally exercise index restart/retry,
updates/retirement, historical citations, active-delete races and token revocation.

## Accounting, failed trials and reproducibility

The user authorized $10 and controls the key cap. The gateway `/v1/usage` explicitly
declares USD. At final model completion, key cumulative `actual_cost` was
**$0.199568112**, nominal `cost` $1.6630676, and its counter reported 630 requests.
Eight preserved ledgers contain 581 dispatch records and eight missing usage
records. Dispatch and provider counters are distinct; their full accounting
semantics were not independently audited. Missing usage is unknown, not zero.
Wallet deltas include other account activity and are not wholly attributed to
this evaluation. Per-request USD/unit prices were not supplied, so no price per
question is claimed.

[Measurements](pageindex-measurements.json) retain per-lane calls, available
tokens, first-output/wall-time distributions, errors/cancellations, cost intervals
and lifecycle observations. Index cohort usage counts selected attempts;
historical attempts remain in reports/ledgers. The development proxy serializes
dispatch and caps output at 8,192 tokens. That comparison control is not an
application setting or throughput result.

Preserved failures include the 30-second preflight timeout, initial malformed
JSON/comparison interruption, invalid anchors, native citation markers,
repeated-margin Standard construction, gateway length/overload, intentional Stop
and process loss. The first full trial had Standard 8/15 ready, one failed
question and two unavailable questions. Targeted runs resolved those defects;
the final explicit retry completed the large input. Failures are not dropped or
silently retried by the application.

Use a fresh private provider JSON, owner-controlled quota and the clean pinned
comparator checkout. To reproduce the selected cohorts, apply each raw report's
selection using `LOREWEAVE_EVAL_FIXTURES`, `LOREWEAVE_EVAL_QUESTIONS` and
`LOREWEAVE_EVAL_MODES`, with separate `LOREWEAVE_EVAL_REPORT`/`LOREWEAVE_EVAL_LEDGER`.
The final large trial uses `LOREWEAVE_EVAL_RETRY_FAILED=1` for one deliberate retry;
regression also uses `LOREWEAVE_EVAL_LIFECYCLE=1` for detach/Stop/SIGKILL.

```sh
export LOREWEAVE_EVAL_PROVIDER_FILE=/path/to/private-provider.json
export LOREWEAVE_PAGEINDEX_REFERENCE=/path/to/pinned-PageIndex
bun run eval:real
bun run eval:full-reference
LOREWEAVE_REFERENCE_FIXTURES=encrypted.pdf \
  LOREWEAVE_REFERENCE_REPORT=docs/evaluation/pageindex-encrypted-reference.json \
  LOREWEAVE_EVAL_LEDGER=docs/evaluation/pageindex-encrypted-reference-ledger.json \
  bun run eval:full-reference
bun run eval:compare
bun run eval:report
```

The comparison report records its exact candidate/reference order, overrideable
with `LOREWEAVE_COMPARE_CANDIDATES`/`LOREWEAVE_COMPARE_REFERENCES`. Re-execution
makes new billable work; preserved artifacts can be inspected without paid replay.

Local checks passed seven Bun tests / 55 assertions, 23 desktop/mobile Playwright
scenarios, PG persistence 21 passed / seven optional skips, locked install,
type/build/format/docs, isolated baseline HTTP/Range/SSE/MCP/SSR/Query/Form and
server-only bundle checks. Desktop/mobile original canvases have
[retained screenshots](pageindex-screenshots/original-390.png); the live service
has [startup/browser evidence](../development/pageindex-local-service.json).
Hosted CI, non-Chromium engines, broad real-world quality and remote termination
remain unrun/unobservable with reasons/risks in the matrix.

[Cleanup evidence](pageindex-cleanup.json) records removal of six disposable
evaluation databases and temporary original directories after measurement.
Raw database/directory fields identify run-time provenance; they no longer
imply retained live databases. Original fixture bytes, extracted pages/trees/read
evidence, reports and screenshots remain. Private logs and verified P01 recovery
live outside the repository. Main database/originals and other services remain.
