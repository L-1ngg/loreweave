# Capacity tooling and acceptance preparation

Issue #18 remains an execution task requiring actual corpus access, independent
reviewers and an authorized real-provider runtime. The commands below make the
preparation and load protocol executable. Controlled runs do not establish the
1,000-document capacity baseline or any real-model quality/latency target.
The current application bootstrap uses scripted providers; changing only a
configuration label cannot turn it into a real-provider deployment.

Run the software checks and small controlled load against disposable PostgreSQL:

```sh
TEST_DATABASE_URL=postgres://... bun run test:capacity
TEST_DATABASE_URL=postgres://... bun run eval:capacity-fixture /tmp/new-capacity.json
```

The fixture runs 20 requests per scenario (16 ordinary / 4 complex), through five
unfinished public HTTP requests, first idle and then overlapping one real Markdown
replacement. It executes actual identity/Wiki/graph workers and captures #20's
public diagnostics. Tests also run a provider returning an unsupported answer:
those requests remain failures in the denominator even if they finish quickly.
This is a bounded integration fixture, not the 1,000-request acceptance run.

For real load, create a configuration JSON using this shape. All paths are relative
to the invocation working directory; credentials remain in environment variables.

```json
{
  "endpoint": "http://127.0.0.1:41736",
  "manifest": "manifest.json",
  "dataset": "acceptance.json",
  "development": "development.json",
  "plan": {
    "schemaVersion": 1,
    "mode": "acceptance",
    "scenario": "idle",
    "profile": "combined",
    "seed": 18,
    "total": 1000,
    "concurrency": 5,
    "environment": {
      "hardware": "Record actual host, CPU, RAM and database resources",
      "providerQuotas": "Record actual model IDs and rate/concurrency limits",
      "warmup": "Record index/cache warmup and answer lengths",
      "answerCache": "disabled"
    }
  }
}
```

```sh
bun run eval:capacity capacity-config.json new-capacity-report.json
```

Set `LOREWEAVE_EVAL_TOKEN` to a member session with only `read`. The runner checks
the frozen dataset/distribution, runtime profile, unchanged 30/60-second deadlines,
active source inventory and text hashes before load. Acceptance requires exactly
1,000 current Markdown documents and at most 20 million Unicode code points in
the originals; current versions are enumerated through a paged inventory rather
than the latest 100 import events. Model identifiers reported as scripted or
controlled cannot qualify. Hardware, quotas and disabled answer caching are
operator declarations retained verbatim, not remotely verified by the harness.

To measure interference, use a fresh copy of the same corpus and configuration,
change `scenario` to `update-interference`, and add an `update` object with `file`
(an original Markdown file), `documentId`, `expectedPrior`, a stable idempotency
`key`, and optional `projectId`. Set a separate `LOREWEAVE_UPDATE_TOKEN` with import
permission. After submitting the fifth question, the runner uploads and imports
that one supplied replacement through public APIs. Benchmark questions, expected
answers, labels and generated reports never pass to the write client. The runner
records the operation ID; if outcome is uncertain, inspect that operation/key
before reusing the configuration. Do not create a new key just to bypass an
uncertain result. Output paths must be new; no load starts for an existing output.

Keep five request slots occupied until all 1,000 requests finish. Seeded xorshift32
shuffling produces an exact 800/200 workload; repeats are load samples only. Timing
starts before submission and ends after the complete public run result, including
queueing and normal retries; grading and post-run diagnostic reads are excluded.
A timing success requires a reviewed answer with citations, or a reviewed partial
answer for a labelled missing-evidence case with the expected gaps. Failed,
unreviewed and incomplete sufficient-evidence answers cannot earn a timing pass.

Reports retain every row, complete run snapshots, review/generation timings,
phase request counters and coverage of those counters, answer lengths, all-class
p50/p95, timeout/deadline breaches and success-within-target numerators. Failures
remain in the denominators and latency distribution. Missing token/pricing
telemetry stays unavailable. `eligibleForAcceptance` means the recorded protocol
can be considered in acceptance; it does not mean the performance targets passed.
Evaluate at least 760/800 ordinary requests within 15 seconds and separately
report all 30/60-second hard-cutoff breaches and failures. Independent quality
scoring is still required through `eval:run` / `eval:grade`.

Authenticated maintenance observations sample every 100 ms. An idle run rejects
observed activity, new accepted knowledge operations or changed sources. An
interference run requires observed running work in at least one configured Wiki/graph stage while
questions remain unfinished, attributed to this exact update operation. Each
derived stage has a separate overlap flag; one observed stage does not establish
overlap or completion of the other. A running worker may still await shared
provider admission; persisted request timestamps separately record model dispatch.
Source preparation overlap is reported separately; pending jobs alone cannot
establish interference. The changed source must also match the accepted operation.
Very short work may evade polling, producing an unestablished interference result;
it must not become a fabricated mixed-workload pass. Post-run observation failures
retain request rows and make the protocol ineligible. Source/Wiki/graph timing
comes from separate #20 diagnostics; pending refresh remains unavailable and can
be captured again later with `eval:maintenance`. It is not an update-time SLA.

For preparation and a human-readable question-quality comparison, create a paths
file with optional `manifest`, `development`, `acceptance`, `report` (the original
`eval:run` artifact) and `grades` (its independent annotations). An empty `{}`
records missing prerequisites without manufacturing questions or reviewers:

```sh
bun run eval:prepare preparation-inputs.json new-preparation-directory
```

This writes `preparation.json` and `preparation.md`. It checks the 50-question
40/10 development set, the frozen 200-question 160/40 acceptance set and its exact
evidence-condition distribution, disjoint paraphrase groups, input hashes and
reviewed references. For a complete four-profile report, it requires all 800
independent judgments and matching model/base settings, then reports paired gains
and regressions, category counts, ordinary/complex thresholds and descriptive
Wilson 95% intervals. Missing labels cannot turn into passes. The report consumer
has a synthetic regression test; those test annotations are never emitted as
acceptance data by either fixture command.

Preparation always leaves release assessment `not-assessed`: supplied files do not
prove resource access or that a human actually reviewed an answer. Complete the
remaining independent evidence under [the evaluation plan](../rag-evaluation-plan.md):
20 Wiki pages with at least 18 passing and all checked links resolving; 12 lifecycle
scenarios; the additional evidence/freshness/identity/retirement/continuation/graph
closure cases; held-out routing and deferral judgments; idle and interference
capacity records; and initial/update maintenance cost where known. Retain exact
source/page/operation versions, raw reports and reviewer notes. Tune only on the
development set. Keep #18 and the parent specification open until that execution
has real evidence.
