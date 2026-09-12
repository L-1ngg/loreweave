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
  the full run is not described as green. The initial measurement commit did not modify operations or relax this test.
  A subsequent CI failure prompted the separately recorded delivery fix below.
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

## CI-discovered lease renewal correction

The pushed measurement commit `5280770638391c26b144bdcca844992f5fa8b3d7` failed
[CI 34684651085](https://github.com/L-1ngg/loreweave/actions/runs/34684651085)
in the same expired-renewal test. Repeating that exact test ten times locally
reproduced five failures. This was a product race, not merely a test delay:
PostgreSQL can evaluate an UPDATE expiry predicate before waiting for a row lock.
If the locking transaction releases an unchanged row after expiry, the pending
statement can extend the stale lease.

The narrow follow-up acquires the job row lock in a transaction, then issues a
new guarded UPDATE so fence/state/expiry are checked after the wait. Existing
regression assertions and timing were unchanged. The same ten-repeat test then
passed 10/10 (40 assertions). This delivery correction does not alter the frozen
comparison artifacts; those are measurements of the preceding implementation.
A new route quality run was not performed after this lease fix, because no
quality improvement is claimed and the original measurement remains valid
historical evidence. Fully populated derived-route benefits remain unmeasured.

The first related regression run had 59 passes and one Graph test sampling race:
maintenance inspection reads jobs and model requests separately, allowing a
pre-admission null deadline alongside an admitted request. The test now waits
for both fields before recording its recovery baseline, asserts the deadline is
present, and retains the exact unchanged-deadline assertion after takeover.

Final related regression: **60 passed, 0 failed**, 343 assertions across
Operations, Graph, Wiki and verification lifecycle tests. Typecheck, formatting
and documentation checks passed after the follow-up. Both review axes accepted
the three-file correction without actionable findings.
