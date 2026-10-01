# P03 execution evidence

Model connections/defaults are implemented through authenticated Start server
functions, TanStack Form and Query. PostgreSQL stores immutable connection
revisions; API keys are sealed with AES-256-GCM, random IVs and owner/revision
associated data. Reads contain nonsecret metadata and `hasSecret` only.
Index/QA captures reference a revision, model and finite system budgets; the
maintained OpenAI-compatible Chat Completions adapter unwraps only server-side.
Official OpenAI uses its official v1 default; compatible Base URLs are explicit.
Invalid/missing settings fail; fixture mode permits loopback endpoints only.
There is no provider/mode fallback or parallel provider loop.

Ran: typecheck/build and 4 Playwright tests against disposable real PostgreSQL.
Settings saved independent index/QA models, verified the controlled endpoint's
tool loop (2 model calls) and structured path (1), and recorded exact Model ID,
Base URL and authentication routing. Editing the key produced a new revision;
old and new captured revisions each dispatched successfully with their own
credential. Reload restored role defaults. SQL and browser/SSR checks found
neither plaintext key nor sealed storage data in returned settings. A discovered
cross-form reset race was fixed and the suite rerun successfully.

Bounds are documented in `docs/development/pageindex-limits.md`. The compatibility
test button exercises tools, stream and schema output through TanStack, so an
advertised protocol or text-only response is not presented as verification.
Not run: paid OpenAI or another real compatible model/profile. Why: controlled
protocol verification precedes composed indexing/QA and final quality evaluation.
Risk: real endpoint/model capability and cancellation are separate acceptance
evidence; failed verification remains explicit. No commit/push was made.
