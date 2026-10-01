# Issue #46: conversation management and manual resend

Create/list/history/rename use stable Router identities and canonical PG snapshots.
Deletion locks the conversation against question acceptance, checks both active
ownership and queued/running/stopping runs, and tombstones only that conversation.
The UI explains Stop-before-delete, while the service enforces it for every caller.
No document/original deletion follows. Rename/delete invalidate only affected Query
metadata. Failure/interruption exposes deliberate resend as a new submission, user
turn, run and captured current configuration; old records/references remain.

Ran: production build/typecheck, a desktop/mobile CRUD/resend/race Playwright test
and the actual process-loss lifecycle test with real PostgreSQL/public functions.
Rename/reload preserved identity/history, failed-answer reload made no model call,
manual mobile resend created a different run and retained the failed question.
Active deletion rejected through HTTP and UI; explicit Stop/terminal release allowed
deletion. Other conversation/library/PDF stayed available. Concurrent question/delete
accepted exactly one action. SIGKILL/restart retained the renamed history and
interrupted outcome, did not replay, and manual interrupted resend created a third
run while retaining earlier completed/interrupted records. All passed.

The interface adds no editing, branches or completed-answer regeneration. Server
checkpoints survive restart; uncommitted emitted tokens are not guaranteed. No
commit/push made.
