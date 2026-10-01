# PageIndex v1 evaluation

Measured on 2026-10-01 for the TypeScript application delivered in
`72b8023083e1ca0eab69ad19e7af90cc6c339506`. Raw reports, ledgers, screenshots and
execution snapshots are preserved in [external recovery storage](../history.md#private-recovery).
This concise report summarizes those records; it does not claim a new
real-provider evaluation. [The evaluation method](../development/evaluation.md)
describes explicit local inputs and paid reruns. [Issue #47](https://github.com/L-1ngg/loreweave/issues/47)
records the delivery acceptance evidence.

## Corpus and execution

The corpus contains 15 frozen, project-authored PDF inputs per mode and 11 fixed
Web questions plus one independent MCP question per mode. It covers columns,
Chinese/English, fonts, rotation, trustworthy/misleading outlines, printed TOC
offsets, no TOC, large sections, shared boundaries and the 20/21-page navigation
policy, including scanned/encrypted/malformed inputs. The
[fixture manifest](../../tests/fixtures/pdf/manifest.json),
[additional sources](../../tests/fixtures/pdf/question-manifest.json),
[boundary derivative](../../tests/fixtures/pdf/boundary-manifest.json) and
[questions](../../tests/fixtures/questions.json) pin original facts and bytes.

TS ran through compiled Start/Bun 1.3.12 public HTTP/server functions, PostgreSQL
17 and official MCP client 2.0.0. Actual authorized compatible-provider
`gpt-6.1-sol` calls exercised tools, streaming, structured output and both roles.
The model identity is provider-declared. No separate direct OpenAI account was
tested. The isolated Python comparator was pinned to PageIndex
`d2693d80791a86345ef78b3234834f5fe53a70a0`; it never entered the app runtime.

The selected cohort uses the full trial, targeted regression, earlier large retry
and final large trial in that explicit order. It is not one uninterrupted first
pass. Initial failures and all rejected inputs remain in raw reports/ledgers.

## Import and navigation results

| Measurement                                                      | TS Flash | TS Standard | Python Flash | Python Standard |
| ---------------------------------------------------------------- | -------: | ----------: | -----------: | --------------: |
| Inputs, including rejections                                     |       15 |          15 |           15 |              15 |
| Latest ready/completed                                           |       11 |          12 |           10 |              10 |
| Accepted TS trees with valid bounds, full coverage and summaries |    11/11 |       12/12 |          N/A |             N/A |
| Shared-question original reachability checks                     |    13/13 |       13/13 |        13/13 |           13/13 |
| Successful index median                                          | 34.157 s |    19.571 s |      0.078 s |       120.557 s |
| Successful index p95/max                                         | 88.217 s |   146.309 s |     29.593 s |       210.185 s |

Flash refuses the structurally inadequate input; Standard accepts all 12 readable
inputs in the selected cohort. Both TS modes reject scanned/encrypted originals
and fail the malformed input. Python additionally fails large-section in both
modes and inadequate in Standard. Failed pairs remain in the denominator; these
counts do not establish general TS superiority.

All 12 mutually extracted inputs preserve each physical page's normalized
non-whitespace character multiset. Two have identical normalized order; ten differ
between geometric ordering and PyPDF2 content-stream order. Authored column order,
CJK qualifications, rotation and labels are separate extraction checks. Exact
reference tree shape and IDs are not acceptance targets.

The final Standard large trial first failed on gateway overload, then succeeded
after one explicit same-operation retry with validated extraction reuse. Its
146.309 s includes the failed attempt; success alone took 78.943 s and 11 model
calls. No automatic mode or provider fallback was added.

## Answers and original support

| Latest selected measurement                          |             Flash |          Standard |
| ---------------------------------------------------- | ----------------: | ----------------: |
| Web questions completed                              |             11/11 |             11/11 |
| Independent MCP QA completed                         |               1/1 |               1/1 |
| Web factual answers / evidence gaps / clarifications |         9 / 1 / 1 |         9 / 1 / 1 |
| Web model / tool calls                               |           35 / 30 |           33 / 29 |
| Web page-read records                                |                35 |                44 |
| Web input / output tokens                            |   109,308 / 4,270 |   103,607 / 4,223 |
| Web median / p95 latency                             | 27.395 / 48.132 s | 22.191 / 63.094 s |
| MCP model / tool calls                               |             3 / 2 |             3 / 2 |
| MCP latency                                          |          18.400 s |          18.200 s |

The implementation agent reviewed all 24 selected outcomes against their immutable
originals: 20 factual answers have claim-adjacent support, two report evidence
gaps and two ask for clarification. Review checked company, year, currency,
business scope, audit/subsidiary qualifications, arithmetic and conflicting sources.
This is not a blind independent review or a general financial/legal/scientific
accuracy estimate.

| Case                                  | Reviewed finding                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Revenue and printed TOC               | Correct amounts/qualifications on physical originals, including printed-label offsets                 |
| Follow-up                             | Fresh 2025 reads; Flash wording about matching scope is weaker than Standard's explicit qualification |
| Missing fact / ambiguous target       | No invented employee count or silently selected annual report                                         |
| Long and mixed 20/21-page scope       | Distinct source/page reads, correct year differences and per-document navigation                      |
| Chinese qualification                 | Preserves amount/scope and leaves unstated currency unspecified                                       |
| Conflicting / distinct sources        | Preserves unresolved differences and company/currency identity without averaging or summing           |
| Library discovery and independent MCP | Correct discovered source and original-supported independent answer                                   |

Literal revenue substring checks fail on equivalent `USD 120 million` wording;
original review establishes equivalence. Lexical results remain visible and are
not semantic scores. Server reference validity certifies access/location, not
claim entailment. The archived semantic review retains per-question findings and
earlier defects.

## Lifecycle, defects and accounting

Real both-mode detach/reload/navigation/closure left accepted work running with
zero extra calls on duplicate acceptance/reattachment. Stop settled locally in
59/61 ms with observed transport abort. SIGKILL/restart kept committed history,
marked unfinished work interrupted and replayed zero calls. Provider-side compute
and billing termination were unobservable.

Earlier trials retain invalid anchors/native citation markers, malformed JSON,
preflight timeout, Standard repeated-margin heading failures and gateway
truncation/overload. A Flash parent summary wrongly combined years on a shared
boundary page. Its reduction input was corrected to retain physical bounds and
distinguish navigation coverage from factual location; targeted original review
passed. Summaries still can compress qualifications and never replace QA originals.
The first full Standard trial was 8/15 ready with one failed/two unavailable
questions; targeted results and the final explicit retry produced the selected
cohort without deleting those earlier failures.

The authorized budget was $10. The gateway's USD `actual_cost` counter ended at
$0.199568112 with 630 reported requests. Eight ledgers retain 581 dispatch records
and eight records without usage. Provider and dispatch counters have different,
not independently audited accounting semantics. Missing usage is unknown; wallet
changes include unrelated activity. Per-request USD/unit prices were unavailable.
The accounting proxy serialized dispatch and capped outputs at 8,192 tokens;
latencies are observations under that control, not application throughput claims.

## Verification boundary

Ran at delivery: seven Bun tests / 55 assertions, 23 desktop/mobile public-browser
scenarios, official PG persistence conformance 21 passed / seven optional skips,
locked install, types/build/format/docs, compiled HTTP/Range/SSE/MCP, protected
SSR/Query/Form, server-only bundle and private-cache checks. Controlled tests also
exercise updates/retirement, index retry/restart, revoked credentials and
conversation deletion races. The archived acceptance snapshot contains the
historical acceptance matrix; [live issue evidence](https://github.com/L-1ngg/loreweave/issues/47)
owns work-item completion.

Not run at delivery: hosted CI, other browser engines, a separate direct OpenAI
account and population-scale quality. Remote compute/billing termination and
checkpoint completeness between commits were not observable guarantees. Original
service/database paths are historical provenance; disposable measurement resources
were subsequently removed. Offline recomputation and documentation restructuring
do not turn these unverified boundaries into new acceptance claims.
