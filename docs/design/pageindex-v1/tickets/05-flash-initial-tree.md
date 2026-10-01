# P05: Inspect Flash layout-derived chapter trees

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#34](https://github.com/L-1ngg/loreweave/issues/34)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

An owner can inspect the initial Flash hierarchy and physical-page coverage derived from stored PDF layout/bookmarks, with explicit structural failures. This establishes the shared attempt/tree publication machinery used by both indexing modes.

## Acceptance criteria

- [ ] Initial Flash heading/hierarchy construction uses layout/font/numbering information and trustworthy outline fusion without a model call.
- [ ] Expose an inspectable candidate tree through the document workflow with meaningful titles, stable index-revision-bound node identities and one-based inclusive ranges.
- [ ] Validate heading locations, hierarchy, page bounds, front-matter reachability and legitimate shared boundary pages; retain merged headings as navigation metadata.
- [ ] Inadequate structural extraction has an explicit failed/unsupported outcome; a large page-only fallback is not labelled a successful chapter index.
- [ ] Implement shared candidate/artifact validation, attempt stage tracking and guarded publication contracts that Standard can use independently of Flash inference.
- [ ] Keep Flash preselected, persist the selected mode and never automatically change it; a draft initial tree remains unready until its required default refinement/summary stages complete.
- [ ] Compare candidate artifacts with the fixed Flash reference on the frozen fixtures without requiring identical internal trees or node IDs.

## Blocked by

- [#33](https://github.com/L-1ngg/loreweave/issues/33): Import PDFs and inspect stored original pages

## Spec coverage

AC03, AC04, AC19, AC20. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record initial-tree inspection, zero construction-model calls, coverage/range validation and structural refusal cases. Full Flash readiness belongs to P06, not this candidate-only path.
