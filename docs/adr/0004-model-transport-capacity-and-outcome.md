---
status: superseded by ADR-0005
date: 2026-09-13
---

# Separate model HTTP capacity from remote outcome uncertainty

The user requested diagnosis and restoration after eight unknown requests blocked
all model work. The incident demonstrated that caller deadlines destroyed useful
completion evidence: six maintenance requests were cut off at 45.007–45.026 seconds
and two interactive requests at their run deadlines. One interactive dispatch had
only 280 ms remaining. No evidence established eight ongoing remote computations.

The synchronous SiliconFlow API provides a trace header and stream completion,
but no inspected public contract for synchronous status lookup, disconnect
cancellation, or maximum remote lifetime. The provider investigation is retained
in the [verified recovery baseline](../history.md#private-recovery).
Indefinitely counting every unknown remote outcome makes a finite authority
permanently unavailable after enough disconnects. Expiring a lease cannot resolve
that uncertainty.

Under the user's recovery instruction and Q36 design delegation, change the
admission invariant to **at most eight owned HTTP requests, six background**.
This explicitly supersedes issue 28's stronger interpretation that unknown remote
executions must consume capacity indefinitely. It does not establish a bound of
eight unseen computations or exactly-once billing at the provider. The live issue
has not been edited; its AC09 remote-termination wording needs this amendment
before issue-wide acceptance can be claimed.

A caller deadline stops delivery and further domain work. The transport owner
continues reading the already dispatched response, retaining its capacity and
heartbeat, for at most five minutes from dispatch. Complete non-streaming bodies,
OpenAI `[DONE]`, and Anthropic `message_stop` provide protocol completion evidence.
The owner records trace IDs at headers, including `x-siliconcloud-trace-id`.
Cleanup timeout, lost authority or network failure closes the local transport,
then releases HTTP capacity while keeping the remote outcome `uncertain`.
SSE EOF without a terminal marker is also uncertain. This does not authorize
replaying the same logical operation/input; the uncertainty ledger still blocks it.

`capacity_released_at` and structured `capacity_release` are independent of
`state`, `settled_at` and provider `reconciliation`. A dead owner's lease alone
releases no dispatched capacity. An operator can record concrete client process
termination evidence after its lease expires, releasing only HTTP capacity.
Provider completion/termination reconciliation remains a separate action after
local transport capacity has been released; it cannot bypass a live connection.
Unreleased orphan uncertainties filling the authority cause immediate
`model_capacity_blocked`, rather than an entire run waiting with zero dispatches.

Close stops admission, waits pre-dispatch work, then drains dispatched responses
before stopping the heartbeat and database. Host result deadlines remain 30/60
seconds; Host settlement and writer ownership wait for transport cleanup.
Provider JSON requests honor their configured timeouts; admission no longer
silently substitutes 45 seconds. No retry budget, expired accepted job, source
version, historical failure report, or provider/model choice is reset by recovery.

Migration 0036 adds audit/capacity columns without changing historical request
states. Existing uncertain capacity requires evidence-based client or provider
reconciliation. All processes sharing an authority must use the new semantics;
mixed old/new workers retain the old blocking count and cannot implement this
recovery policy consistently.
