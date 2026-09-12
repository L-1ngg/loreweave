# Issue #25 route comparison assessment

**Measurement complete; quality/latency acceptance not met.** The independent
agent-reviewed development comparison used 20 frozen Forge documentation sources
and 24 questions (18 ordinary, 6 complex), with all four profiles queried through
the public answer interface. The maintainer explicitly authorized independent
agent dataset review and scoring for this issue. This is not human review and
does not close #18 or certify a release.

## Observed real-provider results

The run used `deepseek-ai/DeepSeek-V4-Flash` for answering and `BAAI/bge-m3`
(1024 dimensions) for embeddings. All four profiles shared original versions,
project scope, model, base retrieval, context policy and 30/60-second budgets.
The full 96-request denominator is retained: **93 timed out, 3 partial, 0 answered**.
Every profile had zero retrieved Wiki and graph candidates. Derived quality gain
is therefore **not established**, not zero in general.

| Profile | Ordinary P50/P95 (s) | Complex P50/P95 (s) | Answered | Partial | Timeout | Model / embedding requests |
| --- | --- | --- | --- | --- | --- | --- |
| source | 30.026 / 30.038 | 60.021 / 60.041 | 0 | 0 | 24 | 94 / 32 |
| wiki | 30.031 / 30.041 | 60.027 / 60.037 | 0 | 1 | 23 | 89 / 31 |
| graph | 30.029 / 30.041 | 60.026 / 60.031 | 0 | 2 | 22 | 92 / 29 |
| combined | 30.027 / 30.044 | 60.021 / 60.033 | 0 | 0 | 24 | 90 / 31 |

Percentiles are nearest-rank over all attempted requests, including failures;
ordinary n=18 and complex n=6 per route. Client HTTP/observation overhead explains
small end-to-end excess beyond server cutoff; these measurements do not alone
establish a server deadline defect. Queue, retrieval, generation and review
P50/P95 with observed/missing counts are retained in each `summary.json`.
Requests include admitted model phases reported by the host; they are not token
usage or currency. **Monetary cost remains unavailable** because usage/pricing
telemetry is absent. No zero-cost claim is made.

Each route matched 30/49 suggested original reference units (exact-locator recall,
not completeness). Two real answers contain three citations; all three locators are valid;
semantic support is assessed separately by the independent reviewer. Failed
requests remain in quality/availability denominators and are not citation passes.

## Independent answer grading

The independent agent reviewed all 96 real results against frozen original
rubrics and actual citations. Three partial texts scored 3/3 in correctness,
completeness and citation support: Wiki `manual-compact`, graph `clear`, and graph
`revenue-missing`. The 93 timeouts have no answer and score zero; a timeout is not
a correct refusal. Text-quality passes are source 0/24, Wiki 1/24, graph 2/24,
combined 0/24. All complex cases scored zero because no answer was delivered.

These are **text-quality scores**, not complete-delivery passes. `answered` remains
0/96. Applying hash-bound annotations preserves the graph revenue case's original
`fail` (the runner did not admit its uncited partial as a certified expected gap),
so the mechanically graded report has two quality passes, distinct from three
independent text passes. No runtime outcome is rewritten. The controlled reviewer
found eight text-quality passes (two justified missing-answer texts per route),
but all controlled requests were partial and original failures remain failures.

See real [independent review](real-retry/independent-review.md),
[detailed scores](real-retry/independent-review.json),
[hash-bound annotations](real-retry/agent-grades.json) and
[graded report](real-retry/graded-report.json). This rubric comparison is semantic
agent judgment, not human judgment or independent verification of source truth.

## Maintenance and controls

All 20 real originals became searchable. Before answering, Wiki and graph each
attempted 4/20 jobs: four failed, sixteen pending, none ready. The shared 300-second
admission window took about 360.9 seconds including already admitted bounded jobs
settling. No background maintenance ran during route queries. This records actual
unavailable derived coverage and finite work; it does not measure fully populated
Wiki/graph quality. Sequential profile order can confound provider temporal
variation. The occasional partial answers cannot be attributed to derived gain.

The separate controlled run used the same frozen text/questions with controlled
embeddings and scripted generation. It returned 96 partial answers, no complete
answers. All four routes had identical answer/citation arrays per question and
zero derived candidates. Wiki failed on all 20 documents; graph completed empty
reviewed generations. This validates the reporting path and makes the scripted
adapter's limited corpus coverage visible, not real-model quality.

The first real attempt stopped at document 15 after 14 successful preparations;
its failure is retained. The complete subsequent run uses a fresh database and
logs source preparation attempts. A minimal chat connectivity probe returned HTTP
200 in 10.31 seconds, so the endpoint was reachable; that alone does not explain
multi-phase workload timeouts or certify latency.

## Route decisions

- **Source:** retain as the development baseline. It needs a separately scoped
  provider/phase latency diagnosis before any deployment acceptance; 0/24 complete
  answers fails the current workload goal. Do not relax support checks to obtain
  a timing pass.
- **Wiki addition:** do not enable on the strength of this run. No ready Wiki
  corpus or Wiki candidates were available, so quality/cost benefit is unmeasured.
  Recompare only after real maintenance produces reviewed coverage.
- **Graph addition:** do not enable on the strength of its two partial answers.
  There were zero graph candidates; those differences cannot demonstrate graph
  benefit. Establish reviewed graph coverage before the next isolated comparison.
- **Combined:** do not roll out. It delivered no complete answers and no observed
  derived evidence benefit; reassess after source delivery and both maintenance
  routes have usable evidence.

This completes the requested measurement and per-route decision with negative
findings. It does not repair retrieval, lifecycle or provider behavior, which #25
explicitly excludes. The development set includes historical conflicts resolved
by explicit supersession; it does not cover unresolved contradictions or complex
missing-evidence cases. Four paraphrase pairs are correlated samples. No
population accuracy, significance, production capacity or universal route ranking
is inferred. #18 retains its separate human-reviewed formal acceptance scope.

## Reproduction and evidence

- [Frozen questions](reviewed-questions.json) and [independent dataset review](dataset-review.md)
- Real [execution](real-retry/execution.json), [manifest](real-retry/manifest.json),
  [dataset](real-retry/dataset.json), [raw report](real-retry/report.json),
  [phase/route summary](real-retry/summary.json), [maintenance](real-retry/maintenance.json)
- Controlled [execution](controlled/execution.json), [raw report](controlled/report.json),
  [summary](controlled/summary.json), [independent review](controlled/independent-review.md)
- [Initial real failure](real/execution.json), [chat probe](chat-probe.json),
  [fresh software verification](verification.md)
- [Commands and reporting semantics](../../development/evaluation.md#route-comparison-25)

Read execution/provider metadata with the report: report `provenance` identifies
the review procedure, while execution and runtime configuration identify the
actual provider. Run real and controlled commands into new output directories;
credentials are environment-only. Output artifacts contain the already versioned
source snapshot, never the current upstream checkout or secret configuration.
