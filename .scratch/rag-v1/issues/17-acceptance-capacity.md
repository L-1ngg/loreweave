# 17: Run acceptance and capacity comparisons on a frozen corpus

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 10, 12, 13, 14, 15, 16

**Modules:** M01, M02, M03, M04, M05, M06, M07, M08, M09

**Spec outcomes:** AC01, AC02, AC03, AC04, AC05, AC06, AC07, AC08, AC09, AC10, AC11, AC12, AC13, AC14, AC15, AC16

## What to build

The maintainer receives an evidence-backed release assessment showing which quality, lifecycle, latency and cost targets the complete system meets.

## Acceptance criteria

- [ ] Prepare/version the actual corpus and reviewed datasets under the evaluation plan; record reviewer decisions and incomplete preparation rather than substituting unreviewed LLM grading.
- [ ] Compare all four routes under fixed models/base settings and report category-level gains, regressions, failures and uncertainty.
- [ ] Run the agreed five-concurrency workload at the capacity baseline, measuring idle-maintenance and update-interference cases separately.
- [ ] Execute Wiki sampling and maintenance/recovery scenarios with original citation checks.
- [ ] Persist raw results and a human-readable assessment; mark unmet or untested criteria explicitly, and use development data for any subsequent tuning.

## Verification boundary

Complete public product interfaces, real configured providers and database, frozen reviewed datasets, and measured load. Corpus access, a reviewer and authorized provider resources are execution prerequisites, not assumed already available.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
