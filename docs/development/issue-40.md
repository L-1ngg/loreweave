# Issue #40: detach, replay, Stop and restart

Accepted Web questions immediately dispatch one process-owned producer through
TanStack memoryStream durability. Initial and subsequent observers can detach
independently. Browser Request.signal and AI React teardown never supply the
producer controller. Hydration restores canonical messages, run identity, reading
references and bindings; joinRun follows that identity. Completed missing logs
return saved results, and active missing producers fail without model replay.

Stop commits durable intent, uses RUN_CANCEL_REASON and waits for true producer
termination. Conditional updates and the terminal transaction coordinate Stop
with completion; only terminal ownership release permits another turn. Startup
marks unfinished application runs interrupted and SDK runs aborted, preserving
committed history and never re-dispatching them. Restored UI shows the latest
saved completed/failed/stopped/interrupted outcome.

Ran: production build/typecheck and two public-HTTP/Playwright lifecycle tests
against real PostgreSQL. Delayed tool/output work survived early reload, Router
navigation and closure of the last viewer, completed without viewers, and reopened
on mobile with unique stable message identities and no extra model calls. Duplicate
submission retained the same run and budgets. Explicit UI Stop interrupted the
controlled provider's actual request signal, stored stopped/no final answer and
released ownership. Unauthorized and forged attachments/hydration rejected.
A second compiled process was SIGKILLed during QA; restart restored interrupted
history and previous citations with zero additional provider calls. Missing logs
after restart returned saved completed/interrupted results. All passed.

Not run: remote third-party computation termination or billing. Observed local
abort and controlled-provider signal establish cancellation propagation, not a
remote provider's implementation. Snapshots are bounded checkpoints, not a promise
that every token survives SIGKILL. No commit/push made.
