# Issue #25 verification

Starting commit: `f7645e7304e7021989039cc8865cc9b8cf8762b6`. The initial index,
worktree and untracked set were clean. This task changes evaluation tooling,
review provenance, regression coverage and retained measurement evidence.

## Fresh software checks

- TypeScript typecheck, Prettier check, documentation links and pinned vendor
  provenance passed.
- Full backend/domain run: **222 passed, 1 failed** across 25 files (223 tests,
  1,553 assertions). The failure was the pre-existing operations test
  `a renewal blocked past expiry cancels execution and cannot resurrect its lease`:
  the replacement claim was `undefined` instead of the expected job ID.
- A focused rerun of the complete `tests/operations.test.ts` file passed:
  **6 passed, 0 failed**, 25 assertions. The initial failure remains recorded;
  the full run is not described as green. No operations implementation or lease
  test was modified by this task. Residual risk: this timing-sensitive regression
  was not diagnosed to a root cause by this measurement task.
- The targeted evaluation regressions passed, covering report/hash binding,
  agent-versus-human provenance, unavailable-route grading, original-quote
  mapping, percentiles and partial checkpoint preservation.
- Upstream SDK suite: **43 passed, 0 failed**, 771 assertions.
- Browser suite on a separate disposable database: **16 passed**.
- Browser production bundle build passed.

The new percentile/provenance regression was first observed failing because its
implementation did not exist, then passed after implementation. Testing uses
existing public evaluation/report boundaries under #25; agent judgments are
separate from product support checks and software regression results.

## Review

The Standards and Spec axes independently reviewed work in progress against the
starting commit; both reported no actionable code findings. Final measurement
artifacts, all 192 independent annotations and the final assessment were refreshed
under both axes before commit. Hash bindings and report totals were rechecked.
Two minor prose counts (citation locators and elapsed maintenance time) were
corrected to match the artifacts; no actionable code findings remained.

## Runtime evidence

Controlled and real-provider measurements live in separate directories. Their
`execution.json`, normalized dataset, source manifest, original snapshots,
maintenance diagnostics, raw report and independent review must be read together.
The initial real attempt stopped after 14 successful original preparations;
`real/execution.json` retains the failed fifteenth preparation. The subsequent
`real-retry` run uses a different disposable database and records each preparation
attempt. A separate minimal chat probe returned HTTP 200 in 10,310 ms; that is
connectivity evidence, not answer quality or a latency percentile.

The dataset is a small development comparison, not #18's human-reviewed holdout,
production traffic, capacity protocol or release certification.
