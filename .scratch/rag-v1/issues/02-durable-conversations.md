# 02: Persist conversations and settle cancellation correctly

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/3)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 01

**Modules:** M07, M08, M09

**Spec outcomes:** AC01, AC12, AC13

## What to build

A member can reload a conversation, reconnect to an executing run and cancel it without losing acknowledged history or launching duplicate work.

## Acceptance criteria

- [ ] Store Forge entries, selected leaf, run IDs and event sequences in PostgreSQL; acknowledged entries reload unchanged.
- [ ] Fence one active writer per conversation and queue same-session turns while independent conversations can execute separately.
- [ ] Reconnection attaches to the existing run and the server continues consuming SDK events when a browser disconnects.
- [ ] Distinguish a canceled/timed-out product outcome from cleanup settlement; do not release its execution slot prematurely.
- [ ] Inject storage failure and missing historical tool results; fault/reconcile the instance and never automatically replay unknown effects.

## Verification boundary

Public host plus browser reconnect with real PostgreSQL and a gated scripted provider/storage failure fixture.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
