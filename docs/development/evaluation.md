# Evaluation

Evaluation separates protocol/lifecycle checks from model compatibility and
semantic answer support. Git keeps reusable scripts, fixed test inputs, this
method and concise [reviewed results](../evaluation/pageindex-v1.md). Raw reports,
screenshots, call/cost logs and execution snapshots belong in ignored run
directories or external archives.

## Fixed inputs and local comparison

[tests/fixtures](../../tests/fixtures/) contains project-authored PDFs, fixed
questions, source/layout transformations and SHA-256 manifests. Verify PDF bytes
with `bun run fixtures:verify`. Cover all supplied inputs, including unsupported
or failed imports, in each mode's denominator. Original facts and physical pages
are the oracle; generated gold prose and upstream scores are not substitutes for
measured TS answers.

Comparison commands require explicit existing result paths. They never load an
old delivery trial automatically. After the TS and full reference runs have
created their reports and accounting ledgers, select them:

```sh
export LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY=.pageindex-data/evaluation/runs/comparison
export LOREWEAVE_COMPARE_CANDIDATES=.pageindex-data/evaluation/runs/ts-trial/pageindex-real.json
export LOREWEAVE_COMPARE_REFERENCE=.pageindex-data/evaluation/runs/reference-trial/pageindex-full-reference.json
bun run eval:compare
LOREWEAVE_COMPARE_INPUT="$LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY/pageindex-paired-comparison.json" \
  LOREWEAVE_MEASUREMENT_LEDGERS=.pageindex-data/evaluation/runs/ts-trial/pageindex-real-ledger.json,.pageindex-data/evaluation/runs/reference-trial/pageindex-real-ledger.json \
  bun run eval:report
```

These two commands make no model requests. Paths may also identify externally
archived results. Additional or retried trials are selected deliberately:

| Variable                           | Meaning                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `LOREWEAVE_COMPARE_CANDIDATES`     | Required ordered comma-separated TS reports; later results supersede earlier selections |
| `LOREWEAVE_COMPARE_REFERENCE`      | Required main isolated full-reference report                                            |
| `LOREWEAVE_COMPARE_REFERENCES`     | Optional additional reference reports                                                   |
| `LOREWEAVE_COMPARE_INPUT`          | Required paired report for `eval:report`                                                |
| `LOREWEAVE_MEASUREMENT_LEDGERS`    | Required comma-separated ledgers for the selected trials                                |
| `LOREWEAVE_MEASUREMENT_CHECKPOINT` | Optional selected accounting checkpoint                                                 |
| `LOREWEAVE_REFERENCE_INPUT`        | Required extraction reference for `eval:extraction` / `eval:flash-candidate`            |

`eval:extraction` compares physical page counts and normalized non-whitespace
characters. Content-stream vs geometric order is recorded separately and checked
against authored column order. `eval:flash-candidate` measures initial structure,
not full model-assisted optimization or answer quality. Both read the explicitly
selected reference and make no model calls. Reports compute costs from the
selected ledgers; semantic support remains pending until the selected claims and
originals are reviewed.

## Isolated Python comparison

`eval:reference` runs the pinned PageIndex extraction/initial Flash comparator
with no model requests. `eval:full-reference` runs full Flash/Standard and **makes
paid model calls**. Set `LOREWEAVE_PAGEINDEX_REFERENCE` to a clean external checkout
at `d2693d80791a86345ef78b3234834f5fe53a70a0`; both commands check the revision.
Python/uv dependencies are isolated development tools, never the app runtime.

For extraction and initial-tree checks, first run `eval:reference` with an explicit
output directory, then set `LOREWEAVE_REFERENCE_INPUT` to the resulting
`pageindex-reference.json` before running `eval:extraction` or
`eval:flash-candidate`.

Accepted trees require valid original anchors, physical bounds, complete coverage
and summaries. Exact reference hierarchy/IDs are not parity gates. Record reference
package versions, parser failures, rejected inputs and comparisons for each mode.
This comparator measures indexing and original reachability, not a Python QA score.

## Real-provider execution

Paid evaluation is opt-in. Supply a private JSON through
`LOREWEAVE_EVAL_PROVIDER_FILE` with `baseURL`, `model`, `apiKey` and `maxUSD` (positive,
at most 10), plus an owner-controlled key quota. The development accounting proxy
requires that gateway's `/v1/usage` to report USD and `actual_cost`; it is not a
generic runtime OpenAI requirement. Keep the provider file outside Git.

```sh
export LOREWEAVE_EVAL_PROVIDER_FILE=/path/to/private-provider.json
export LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY=.pageindex-data/evaluation/runs/ts-trial
bun run eval:real
```

`eval:real` exercises compiled Start public HTTP, real PostgreSQL, actual index/QA
roles and the official MCP client. It creates its own database/build copy/original
directory. The report identifies retained execution resources; inspect it before
removing resources needed for deliberate resume. It leaves other services and the
main database/originals in place. Do not infer ongoing database availability from
historical reports whose resources have already been removed.

Select cohorts with `LOREWEAVE_EVAL_FIXTURES`, `LOREWEAVE_EVAL_QUESTIONS` and
`LOREWEAVE_EVAL_MODES` (comma-separated). `LOREWEAVE_EVAL_LIFECYCLE=1` adds
detach/Stop/process-loss checks. `LOREWEAVE_EVAL_RETRY_FAILED=1` deliberately invokes
one retry; it is not automatic product fallback. `LOREWEAVE_EVAL_RESUME_FILE` must
identify preserved compatible resources. `LOREWEAVE_REFERENCE_FIXTURES` selects
the full Python comparator cohort.

Named output overrides are `LOREWEAVE_EVAL_REPORT`, `LOREWEAVE_EVAL_LEDGER` and
`LOREWEAVE_REFERENCE_REPORT`. Destinations inside the repository must be under
`.pageindex-data/evaluation/runs/`; external directories are also allowed. The
helper rejects other repository paths and their symlink aliases. Use a distinct
directory per trial so earlier failures remain inspectable.

## Review and evidence storage

Inspect factual claims, arithmetic, qualifications and claim-adjacent cited
originals. Distinguish supported answers, gaps, clarifications and incomplete
search. Valid reference location and lexical matching do not establish entailment.
Identify the reviewer and whether review was blind/independent. Disclose targeted
reruns, latency/calls/usage, missing measurements, remote cancellation uncertainty
and the provider-declared model identity.

Archive a run's complete input/output dependency set externally, preserve failures
and rejected inputs, and record source/dataset/provider identity and byte hashes.
Keep private user content and credentials in private storage. The repository may
publish a concise, dated, reviewed report with provenance and limitations; update
the documentation index for a new report. Work-item execution evidence remains
in its GitHub issue. Running a command does not publish its raw outputs to Git.
