# M07: Agent Host

M07 adapts the pinned Forge SDK to a bounded Knowledge Agent run. It owns product
orchestration; it does not fork a second model/tool loop.

## Interface

- Start a turn in a conversation with trusted actor/scope and optional uploads,
  returning a serializable run ID and an observable event stream.
- Cancel a run and report both user-facing outcome and execution settlement.
- Observe/reconnect to an existing run or inspect persisted conversation history.

## Ownership and dependencies

Own conversation/session records, run states, event sequence IDs, shared budgets
and a PostgreSQL adapter for Forge session entries. Preserve native entry IDs,
parent IDs and selected leaf. Forge invocation symbols remain process-local.
Register M02/M05 commands and M06 evidence operations as tools; use M08 operation
IDs to reconcile effects. M01 supplies trusted grants.

The public SDK facade is the dependency seam. Preserve the pinned workspace,
licenses and provider patch. Configure supported policies first, implement host
policies outside vendor code, and isolate necessary SDK request-admission changes
as attributable patches with regression cases. See the Forge reuse investigation
and ADR-0003 linked from the module map.

## Invariants and failure behavior

One active writer per conversation with database fencing; independent sessions
may run concurrently. The server consumes SDK events even when the browser
disconnects. Stream provisional progress and publish M06's validated answer as
the final product result. Normal SDK iterator completion and turn.result govern
persistence settlement; agent_end alone is not a commit acknowledgment.

Every actual model call, summary and retry acquires the shared budget before
dispatch. Tool budgets are checked before effects. Route finalization through
M06's separate tools-disabled generation and support-review calls within the
reserved time, with phase-specific admission under C05/V02. Persist the one
host-controlled refreshing transition; it cannot resume Forge exploration. Deterministic receipts and
clarifications need no extra answer-model call. Default permission handling
must not introduce routine user prompts for already authorized operations.

A canceled/timed-out answer may have a committed source update or active
maintenance job. Preserve and report that outcome. Storage uncertainty faults
the instance; reconcile before recreating it. Keep the slot/lease while started
work is still settling; give tool I/O its own bounded timeout and abort support.

## Acceptance boundary

Use the public host with a scripted local provider and counting evidence tool,
real PostgreSQL session persistence and browser event consumption. Assert model-
request ceilings before dispatch, tool-effect counts across retries, cancellation
before first consumption, disconnect/reconnect, two-session isolation, stale
writer rejection, failed persistence and restart with a missing tool result.
