# Evaluation

Evaluation separates protocol/lifecycle checks from model compatibility and
semantic answer support. The current [reviewed report](../evaluation/pageindex-v1.md)
has an immutable [baseline](../../evaluation/baselines/pageindex-v1/README.md).
Routine commands create new outputs rather than overwriting that baseline.

## Fixed inputs and offline recomputation

[tests/fixtures](../../tests/fixtures/) contains project-authored PDFs, frozen
questions, source/layout transformations and SHA-256 manifests. Cover all supplied
inputs, including unsupported or failed imports, in each mode's denominator.
Original facts and physical pages are the oracle; generated gold prose and upstream
scores are not substitutes for measured TS answers.

Verify and recompute the preserved comparison without provider calls:

```sh
bun run eval:verify
export LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY=.pageindex-data/evaluation/runs/offline-review
bun run eval:compare
LOREWEAVE_COMPARE_INPUT="$LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY/pageindex-paired-comparison.json" \
  bun run eval:report
```

The baseline manifest maps historical embedded paths to byte-preserved files.
Those paths, database names and URLs describe the original run, not current
machine state. `eval:compare` and `eval:report` default to this baseline; arbitrary
new reports are selected explicitly rather than by silently choosing the newest
file. Input overrides are:

| Variable                       | Meaning                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `LOREWEAVE_COMPARE_CANDIDATES` | Ordered comma-separated TS reports; later explicit results supersede earlier selections |
| `LOREWEAVE_COMPARE_REFERENCE`  | Main isolated full-reference report                                                     |
| `LOREWEAVE_COMPARE_REFERENCES` | Additional explicit reference reports                                                   |
| `LOREWEAVE_COMPARE_INPUT`      | Paired report to summarize                                                              |
| `LOREWEAVE_REFERENCE_INPUT`    | Extraction reference for `eval:extraction` / `eval:flash-candidate`                     |

`eval:extraction` compares physical page counts and normalized non-whitespace
characters. Content-stream vs geometric order is recorded separately and checked
against authored column order. `eval:flash-candidate` measures initial structure,
not full model-assisted optimization or answer quality. Both default to frozen
reference input and make no model calls.

For a new candidate cohort, `eval:report` requires
`LOREWEAVE_MEASUREMENT_LEDGERS` (comma-separated explicit ledgers). Its optional
`LOREWEAVE_MEASUREMENT_CHECKPOINT` adds the selected accounting checkpoint. New
model outputs cannot silently inherit baseline costs or its semantic support
review. Their review remains pending until the new originals/claims are inspected.

## Isolated Python comparison

`eval:reference` runs the pinned PageIndex extraction/initial Flash comparator
with no model requests. `eval:full-reference` runs full Flash/Standard and **makes
paid model calls**. Set `LOREWEAVE_PAGEINDEX_REFERENCE` to a clean external checkout
at `d2693d80791a86345ef78b3234834f5fe53a70a0`; both commands check the revision.
Python/uv dependencies are isolated development tools, never the app runtime.

Accepted trees require valid original anchors, physical bounds, complete coverage
and summaries. Exact reference hierarchy/IDs are not parity gates. Record reference
package versions, parser failures, rejected inputs and comparisons for each mode.
This comparator measures indexing and original reachability, not a Python QA score.

## Real-provider execution

Paid evaluation is opt-in. Supply a private JSON through
`LOREWEAVE_EVAL_PROVIDER_FILE` with `baseURL`, `model`, `apiKey` and `maxUSD` (positive,
at most 10), plus an owner-controlled key quota. The development accounting proxy
requires that gateway's `/v1/usage` to report USD and `actual_cost`; it is not a
generic runtime OpenAI requirement. Never commit the provider file.

```sh
export LOREWEAVE_EVAL_PROVIDER_FILE=/path/to/private-provider.json
export LOREWEAVE_EVALUATION_OUTPUT_DIRECTORY=.pageindex-data/evaluation/runs/new-real-trial
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
helper refuses docs/baselines and their symlink aliases. Use a distinct output
directory per trial so earlier failures remain inspectable.

## Review and baseline publication

Inspect factual claims, arithmetic, qualifications and claim-adjacent cited
originals. Distinguish supported answers, gaps, clarifications and incomplete
search. Valid reference location and lexical matching do not establish entailment.
Identify the reviewer and whether review was blind/independent. Disclose targeted
reruns, latency/calls/usage, missing measurements, remote cancellation uncertainty
and the provider-declared model identity.

Promote evidence only as a reviewed change: select its complete input dependency
set, preserve failures, remove credentials/private user content, pin source/dataset/
provider identity, hash the original bytes and write a dated report. Historical
snapshots remain immutable; paths can be resolved through a new manifest without
rewriting embedded provenance. Update the documentation index when publishing a
new report. Work-item execution evidence remains in its GitHub issue.
