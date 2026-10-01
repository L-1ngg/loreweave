# P10: Answer selected-document questions with page citations

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#39](https://github.com/L-1ngg/loreweave/issues/39)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner selects one ready document, submits a question, receives streamed original-backed text and reading activity, and opens claim-adjacent citations at the exact immutable PDF page on desktop/mobile.

## Acceptance criteria

- [ ] Commit accepted question/run/scope/version/model configuration before generation; a duplicate accepted submission does not append another question or reset budgets.
- [ ] Use TanStack's maintained tool loop with the four shared reading definitions in-process, without an internal HTTP-to-MCP round trip or question_answer recursion.
- [ ] Implement direct permitted reading at 20 pages or fewer and tree-first reading above 20 pages, with bounded pagination/output and additional relevant reads when necessary.
- [ ] Durably record actual page reads and issue/validate citation handles by run, owner, document/version/page, scope, bounds and availability; invented/out-of-scope handles are explicit failures.
- [ ] Stream reading activity and claim-adjacent document-name/physical-page citations; multi-page support uses separate references and tree summaries do not supply factual evidence.
- [ ] Open the bound original beside the conversation on desktop and in a separate mobile view returning to the same message/position; printed labels do not alter targets.
- [ ] Persist authoritative server history/run/reference state and use the captured QA role; provider/schema/tool failures and missing evidence/incomplete budgets remain distinguishable.
- [ ] Enforce one active conversation writer and a server-owned producer lifetime from the first QA path; browser request cancellation is not wired into accepted-run cancellation.

- [ ] Use AI React's supported chat/connection surface with raw Start SDK SSE delivery; Query caches metadata and supplies hydration snapshots while M05/PostgreSQL remain canonical, without parallel writable transcripts.

## Blocked by

- [#35](https://github.com/L-1ngg/loreweave/issues/35): Publish fully optimized Flash indexes

## Spec coverage

AC07, AC09, AC10, AC16, AC23, AC24, AC28, AC29. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record short/long-document HTTP and browser demos, actual page-read/citation identities, controlled provider/tool counts and invalid-reference cases. Deterministic reference checks do not establish semantic claim support.
