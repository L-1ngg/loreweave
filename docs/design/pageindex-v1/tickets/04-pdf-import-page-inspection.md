# P04: Import PDFs and inspect stored original pages

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#33](https://github.com/L-1ngg/loreweave/issues/33)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner uploads a text-layer PDF, observes its accepted operation and extraction progress, browses its metadata and opens immutable original/page content. The same path exposes extraction defects before a document can be advertised as ready for QA.

## Acceptance criteria

- [ ] Persist immutable original bytes, owner-scoped submission identity, chosen mode and captured attempt configuration before acknowledging upload acceptance.
- [ ] Ordinary uploads with matching filenames create independent documents; reconnect or retry of the same accepted input retains its operation/document identity, and changed payload under the same key is rejected.
- [ ] Use the selected proven PDF engine for text items, geometry, outlines, labels and rotation; both future indexing modes consume this shared page representation.
- [ ] Freeze representative fixture bytes/provenance and compare extraction through the document interface for single/multi-column order, Chinese/English, fonts, recurring margins and front matter.
- [ ] Unreadable/scanned text layers, unsupported encryption, malformed files and extraction failures produce explicit inspectable outcomes rather than empty successful documents.
- [ ] The owner can browse paginated names/descriptions/state, inspect stored pages and open the exact original physical page on desktop/mobile; page reads do not parse the PDF again.
- [ ] Accepted extraction/background progress survives browser detachment and can be observed without resubmitting the import.
- [ ] Extracted pages or a diagnostic candidate alone do not make an index ready for QA; persist only validated stage manifests and expose later construction as unfinished.

- [ ] Use raw Start routes for multipart import and authorized immutable PDF GET/HEAD/Range, preserving response headers/status; Query supplies paginated library/status caches and Form supplies import settings.
- [ ] Accepted operations update/invalidate relevant caches without duplicate submission; server eligibility/version checks govern original inspection regardless of cached state.

## Blocked by

- [#32](https://github.com/L-1ngg/loreweave/issues/32): Configure model connections and index/QA defaults

## Spec coverage

AC02, AC03, AC05, AC10, AC21, AC30. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record import/read HTTP and browser outcomes, original/version identities, duplicate-submission tests and the frozen extraction comparison manifest. Include rejected inputs in coverage; do not claim completed indexing.
