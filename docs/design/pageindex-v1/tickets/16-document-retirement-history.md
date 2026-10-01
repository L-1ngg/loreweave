# P16: Retire documents while retaining authorized historical evidence

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#45](https://github.com/L-1ngg/loreweave/issues/45)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner removes a document from the current library and future Web/MCP questions, while authorized readers can still inspect the immutable original pages supporting earlier answers.

## Acceptance criteria

- [ ] Deletion sets durable retirement, removing the document from current library browsing/discovery and new Web/MCP QA, including follow-ups in existing conversations.
- [ ] Historical answers, source/version/page/index artifacts and references remain retained and resolve the original physical page for currently authorized callers.
- [ ] Current authorization applies to historical originals/resources; revoked access cannot be recovered through an old citation or cached token context.
- [ ] Prior messages, retained originals and page caches do not make retired documents eligible for new factual QA; stale selected scope fails explicitly without widening to library mode.
- [ ] Earlier queued/running indexing and source updates cannot reactivate a retired document when they finish or retry.
- [ ] Retirement persists across restart and preserves other documents/conversations; permanent original purging and retention-policy administration are not introduced.
- [ ] Public HTTP, Web follow-ups, actual MCP primitives/question_answer and desktop/mobile historical inspection verify visibility, cache/scope and late-publication cases.

## Blocked by

- [#43](https://github.com/L-1ngg/loreweave/issues/43): Answer independent MCP questions through shared QA
- [#44](https://github.com/L-1ngg/loreweave/issues/44): Update a document without changing historical citations

## Spec coverage

AC14, AC22, AC26, AC31. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record current-vs-historical access, stale selections, cache reuse refusal, revoked resources and late index/update publication guards through the full Web/MCP boundaries.
