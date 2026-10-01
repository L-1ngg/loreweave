# P11: Keep accepted answers running across browser disconnects

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#40](https://github.com/L-1ngg/loreweave/issues/40)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

An accepted answer continues without a viewer; reload/reopening catches up to the same run, while explicit Stop cancels server work and an application restart restores interrupted history without execution replay.

## Acceptance criteria

- [ ] Use the supported TanStack producer/replay primitives and owned run controller so the last viewer's disconnect leaves bounded model/tool production running.
- [ ] Reattach before the first chunk, during tool calls/later output and after background completion without another question, message duplication, model/tool replay or reset budgets.
- [ ] Hydrate persisted partial content, reading state, scope/version bindings and active run identity before following subsequent output; preserve stable message/part identities.
- [ ] Completed or expired delivery logs fall back to saved canonical results; missing log/producer state never starts a new model execution.
- [ ] Explicit owner-authenticated Stop records cancellation intent and propagates the installed SDK cancellation mechanism to actual provider/tool work; a reader abort is not Stop.
- [ ] Persist distinguishable completed/failed/stopped/interrupted outcomes and require terminal ownership release before accepting a conflicting writer.
- [ ] Application restart marks unfinished prior QA interrupted, retaining committed history and references with no automatic execution replay.
- [ ] Unauthorized hydration/attachments and forged run/conversation IDs are rejected through public boundaries.
- [ ] Desktop/mobile navigation, reload/closure, Stop and restoration checks verify the same run with real PostgreSQL and controlled delayed/streaming providers.
- [ ] Document actual local/provider cancellation evidence and limitations separately from unobservable remote computation/billing.

- [ ] Verify Start Request.signal and AI React teardown detach observation without cancelling the producer or issuing Stop; Router navigation/Query hydration reattach to the existing identity and never submit a replacement turn.

## Blocked by

- [#39](https://github.com/L-1ngg/loreweave/issues/39): Answer selected-document questions with page citations

## Spec coverage

AC11, AC12, AC16, AC27, AC34. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record zero-viewer call counts, early/late joins, delivery-log fallback, explicit Stop, process restart and unauthorized-attachment outcomes. Report real-provider cancellation separately.
