# P15: Update a document without changing historical citations

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#44](https://github.com/L-1ngg/loreweave/issues/44)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner explicitly targets an existing document with Update file, keeps its old usable version during preparation/failure and sees a validated new version activate while prior Web/MCP citations still open the original evidence.

## Acceptance criteria

- [ ] Ordinary same-filename uploads stay independent; only an explicit Update file action with the chosen document identity prepares a new version of that document.
- [ ] Persist update operation/source/attempt identity and expected prior library revision, preserving the previous effective version during either mode's preparation.
- [ ] Publish the new effective source/index atomically only after required original/page/tree/default-summary artifacts validate; failure or interruption leaves the old version readable.
- [ ] Same-operation update reconnection/retry is idempotent; conflicting concurrent updates cannot overwrite a later activation or create an accidental duplicate document.
- [ ] An already accepted QA run retains its source snapshot while a new run resolves the newly effective version; historical messages are not rewritten.
- [ ] Prior page citations and immutable MCP resources continue to resolve the exact original version/physical page after activation, subject to current authorization.
- [ ] Desktop/mobile update/status/retry/source-view workflows and composed HTTP/MCP checks cover both modes, publication failure and concurrency.

## Blocked by

- [#38](https://github.com/L-1ngg/loreweave/issues/38): Recover interrupted indexing with explicit retry
- [#39](https://github.com/L-1ngg/loreweave/issues/39): Answer selected-document questions with page citations
- [#42](https://github.com/L-1ngg/loreweave/issues/42): Authorize MCP clients to read documents and page resources

## Spec coverage

AC06, AC09, AC24, AC30. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record old/new version identities, failed/interrupted and competing updates, stable retry identity, run snapshot behavior and Web/MCP historical citation resolution.
