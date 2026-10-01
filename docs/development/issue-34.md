# Issue #34: deterministic Flash candidate trees

Verified 2026-10-01 against the frozen 12-PDF manifest and PageIndex
`d2693d80791a86345ef78b3234834f5fe53a70a0`. Implementation is in
`src/server/trees.ts`, the persisted candidate path in `indexing.ts` and the
shared guarded `activateIndex` contract in `library.ts`.

Layout/font/numbering construction and original-verified bookmark fusion make
no model calls. Eight fixtures produce candidates with validated original
anchors, hierarchy, inclusive physical ranges and every-page reachability.
The 25-page unstructured fixture fails explicitly; scanned, encrypted and
malformed inputs keep their distinct extraction outcomes. Exact reference tree
shape and IDs are not required; differing classifications and the reference's
24-page structural refusal are retained in
`docs/evaluation/pageindex-flash-candidate.json`.

The public upload/read workflow persisted and displayed candidates, survived a
reload, retained mode selection and recorded zero provider requests. Candidate
IDs remain stable when reloaded; the attempt ID reserves the publication's
index-revision identity. Drafts remain unready at `awaiting_optimization`.
Issue #35 owns full optimization, summaries and activation requirements.

Ran: production build, TypeScript check, 5 Bun tests, 5 Playwright tests, then
the document Playwright test with explicit candidate inspection/reload added.
All passed using a disposable real PostgreSQL database and HTTP server.
Not run: real model quality; deterministic construction uses no model.
No commit/push was made; changes remain in the preserved local worktree.
