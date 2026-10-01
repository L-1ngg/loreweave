# P07: Index printed tables of contents with Standard

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#36](https://github.com/L-1ngg/loreweave/issues/36)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner explicitly chooses Standard for a PDF with a printed table of contents, obtains a model-constructed and verified chapter tree with default summaries, and inspects its published physical-page locations.

## Acceptance criteria

- [ ] Standard executes the complete model-based route for usable printed TOCs through the captured index role, independent of successful Flash inference/refinement.
- [ ] Detect/extract TOC content, form schema-validated title/hierarchy/label candidates and verify physical-page mappings against original-page content.
- [ ] Handle printed Arabic/Roman labels and numbering offsets without confusing them with physical pages; bounded repair cannot introduce unsupported locations.
- [ ] Complement omitted/front-matter pages and validate hierarchy, inclusive ranges and legitimate boundary overlap using the shared artifact contract.
- [ ] Generate default original-backed navigation summaries and publish only fully validated artifacts through the shared guarded library path.
- [ ] The Web mode selector and progress/tree/original workflow identify Standard and never silently run Flash or switch provider.
- [ ] Compare the accepted printed-TOC path with the fixed Standard reference and expose explicit outcomes for mapping/model/validation failures.

## Blocked by

- [#34](https://github.com/L-1ngg/loreweave/issues/34): Inspect Flash layout-derived chapter trees

## Spec coverage

AC03, AC04, AC19, AC20, AC28, AC29. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record a Standard printed-TOC import-to-publication demo, captured model routing, original mapping checks and controlled failure cases. No-TOC and complete subdivision coverage are owned by P08.
