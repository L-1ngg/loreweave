# Issue #38: indexing observation, restart and retry

Accepted indexing is owned by the bounded process worker. Navigation changes
observation only. Startup marks all previously queued/processing attempts and
operations interrupted; it never requeues them. Explicit failed/interrupted
retry retains document/source/operation identity, captures current mode/model
configuration and creates a new attempt. Owner-scoped retry submission keys
make response-loss retries idempotent and reject changed payloads.

Reuse is deliberately restricted to validated extraction. Its original SHA,
source identity, extractor revision, manifest digest and current page budget
must match. Construction/optimization/summaries are regenerated for each new
attempt; no unvalidated partial tree is reused or promoted. This includes an
explicit Flash-to-Standard change, with no automatic switch. Prior attempts,
failure reasons, manifests and usage remain available in Web processing history.

Ran: production build/typecheck and 2 Playwright lifecycle tests on real
PostgreSQL. Desktop/mobile leave/reopen retained the same failed operation;
manual Standard retry reused extraction and published a new attempt for the
same original. A second compiled application process began model work, was
actually SIGKILLed, restarted and restored interrupted history without another
provider request; manual retry then completed. All passed. Start logged a
reader-disconnect AbortError during navigation; the accepted work still
completed, demonstrating observer/producer separation.

Model quality and remote termination/billing remain unmeasured; controlled
requests establish local lifecycle/protocol behavior. No commit/push made.
