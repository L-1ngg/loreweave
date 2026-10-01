# P17: Manage conversations and deliberately resend failed questions

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#46](https://github.com/L-1ngg/loreweave/issues/46)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner creates, renames, reopens and deletes conversations, with explicit Stop before deleting an active one, and manually resends a failed/interrupted question as a new turn while retaining the earlier record.

## Acceptance criteria

- [ ] Create distinct owner-held conversations and list/read saved history; rename, navigation, reload and restart retain the same conversation identity and saved messages/run outcomes.
- [ ] The service rejects deletion while accepted QA is queued/running/stopping, including a concurrent new-turn/delete race; hiding the browser button alone is insufficient.
- [ ] Explicit Stop followed by a terminal outcome enables deletion; a viewer disconnect is not Stop or permission to remove an active conversation.
- [ ] Deletion affects only the selected conversation, leaving library documents, immutable PDF originals and other conversations intact.
- [ ] Manual resend after failure/interruption creates a new question/turn/run with current authorized scope/model configuration and retains the earlier input, committed partial output, source references and outcome.
- [ ] Reload, reopening, navigation and transcript hydration never automatically resend a question or restart interrupted work.
- [ ] The first-version interface exposes no message editing, answer branches or dedicated completed-answer regeneration workflow.
- [ ] Public HTTP, real PostgreSQL, controlled-provider and desktop/mobile browser checks verify identity, history, deletion guards, races and deliberate resend.

- [ ] Use Router identities and Query list/detail metadata with targeted invalidation after create/rename/delete; AI React reconciles canonical message snapshots with the active stream and cached state never bypasses the server deletion guard.

## Blocked by

- [#40](https://github.com/L-1ngg/loreweave/issues/40): Keep accepted answers running across browser disconnects

## Spec coverage

AC11, AC12, AC27, AC35. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record conversation CRUD/history, concurrent deletion/turn results, explicit Stop-to-delete behavior and distinct old/new run identities without duplicate automatic model execution.
