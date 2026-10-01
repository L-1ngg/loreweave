# Issue #35: complete Flash publication

Implemented deterministic small-leaf merging (removed titles retained), bounded
original-backed model subdivision, bottom-up navigation summaries and guarded
atomic activation. Short leaves reuse original text; other leaves/parents use
the captured index role through TanStack AI structured outputs. The original
digest, extraction digest, required stage manifests, final summaries, hierarchy,
anchors, physical ranges and coverage are checked before publication. Canonical
artifact hashing tolerates PostgreSQL JSONB key ordering without weakening checks.

Ran: TypeScript check, 5 Bun tests and 6 Playwright tests against a disposable
real PostgreSQL database and the compiled Start HTTP server. Flash and bound
checks passed; a capability-probe fixture regression in Settings was caught and
corrected before final verification. The
complete rerun passed all 6 browser tests.
12 frozen PDFs produce 8 complete indexes, one structural refusal and three
distinct extraction refusals. `pageindex-flash-indexing.json` records final
artifacts, calls, usage and provenance; `pageindex-flash-candidate.json` retains
the pinned raw Python comparison and its classification differences. Browser
checks cover tree, original canvas/text, Range, reload and mobile return.
Controlled schema failure and call exhaustion preserve failed stages/usage and
never activate an index. Model calls route only to the captured `index-fixture`.

Bounds: 12 pages/18,000 characters per leaf before subdivision, depth 4, original
windows up to 8 pages and captured context bound, short summaries 1,200 chars,
generated summaries 1,600 chars; attempt defaults remain 120 calls/30 minutes.
Failed calls count before dispatch. No mode/summary/optimization fallback toggle
exists. Final activation checks revision/latest attempt/retirement transactionally.

Not run: real model semantic summary quality/cost. Controlled protocol outputs
and the raw Python reference do not certify that quality; #47 remains responsible
for paid evaluation with the user's later OpenAI-compatible connection and $10
budget. No commit/push made; delivery is the local worktree.
