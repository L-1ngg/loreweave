# P06: Publish fully optimized Flash indexes

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#35](https://github.com/L-1ngg/loreweave/issues/35)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

A Flash upload becomes QA-ready after full deterministic/model-assisted optimization, default navigation summaries and validated atomic publication; the owner can browse the finalized tree and original pages.

## Acceptance criteria

- [ ] Apply deterministic small-node merging and bounded model-assisted subdivision using original pages through the captured index role.
- [ ] Preserve original-backed titles/ranges, meaningful hierarchy, merged-heading navigation metadata, front matter and allowed shared boundary pages after optimization.
- [ ] Generate summaries from finalized leaf/parent ranges, permitting short-leaf original-text reuse without a model request; summaries are navigation artifacts rather than answer evidence.
- [ ] Expose only the Flash/Standard mode choice, with no summary/optimization switches or automatic mode fallback.
- [ ] Validate all required original/page/tree/summary artifacts before atomic publication; stage/model/validation failure cannot publish a ready index.
- [ ] Publish guarded effective source/index pointers through the shared library contract and expose final readiness/provenance/progress through the Web document workflow.
- [ ] Enforce and record finite index call/context/output/time bounds including failed work; verify artifacts against the fixed Flash reference on representative fixtures.

## Blocked by

- [#34](https://github.com/L-1ngg/loreweave/issues/34): Inspect Flash layout-derived chapter trees

## Spec coverage

AC04, AC16, AC19, AC20, AC28. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record a complete Flash import-to-tree/page demo, controlled index-model routing, validation/failure outcomes and artifact comparison. Real-model summary quality and cost require measured evaluation.
