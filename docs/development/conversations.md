# Durable conversation bootstrap

Issue [#3](https://github.com/L-1ngg/loreweave/issues/3) adds PostgreSQL persistence
to the scripted #2 host. It does not implement organization authorization or real
knowledge operations; keep the development server bound to loopback.

## Storage and execution

Reviewed [SQL migration](../../migrations/0000_conversations.sql) is applied by
Drizzle. Run migrations once during deployment before admitting traffic. Forge
entries are immutable JSON with native entry/parent IDs. One SQL statement updates
the selected leaf and inserts an entry; a failed insert rolls back both changes.
No SDK synthetic history repair is written back to storage.

A dedicated PostgreSQL connection holds a session advisory lock per conversation.
Every append/checkpoint checks the monotonically increasing fence and original
backend PID in its write statement. Reconnecting the driver cannot reuse a lost
lock. Do not use transaction-mode connection pooling for this adapter.

The host serializes checkpoints; every model/summary/retry admission completes its
checkpoint before HTTP dispatch. Event sequence and run snapshot update atomically.
Cancellation can be visible while an SDK append is still pending. The host exhausts
the iterator and result, waits for dispose and checkpoint completion, then releases
the conversation writer. Failed checkpoints remain durable uncertainty rather
than an acknowledged completion.

The current development process has five execution slots and fifteen total local
admissions. Database fencing also serializes conversations across host instances;
this is not yet a distributed provider-quota scheduler or production capacity proof.

## Reconnection and recovery

`POST /api/runs` accepts an optional conversation ID. It acknowledges only after
initial persistence. `GET /api/conversations/:id` reloads raw history and runs.
`GET /api/runs/:id/events` replays durable sequence IDs; `Last-Event-ID` resumes
within the same run. Browser reload reads the conversation URL and opens SSE;
it never resubmits a turn to restore the view. A remote cancel records a request
that the owning host polls independently of browser connections.

Inspecting an abandoned executing/finalizing/refreshing run reports interruption.
It retains consumed budgets, the original deadline, and draft/superseded identities.
It does not restart generation or tools. An unsettled abandoned predecessor blocks
later turns in that conversation. Unclaimed queued runs are different: inspection
transactionally applies their original deadline or requested cancellation, records
the result/settlement events, and releases their queue position without dispatch.
Claiming a writer atomically makes a queued run ineligible for this shortcut;
claimed work still requires confirmed termination. Live owners synchronize external
queued settlement instead of starting the stopped run.
Use the operator reconciliation command in [README](../../README.md) after confirmed
process/tool termination; lock availability alone only permits recording interruption.
Missing historical tool results block exploration with `history_requires_reconciliation`.
Domain operation reconciliation is delivered by later work; this bootstrap does
not invent a successful or failed result for an unknown effect.

## Verification

Public host plus real PostgreSQL and loopback model HTTP cover persistent history,
independent readers, same-conversation queuing, cancellation during blocked storage,
missing results, source-refresh budgets and interrupted-generation recovery. A
separate database-session termination fixture checks stale-writer rejection.
Chromium exercises reload during execution and after completion, with exactly one
submission across both reloads. These tests do not establish real-provider quality.
