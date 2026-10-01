# Issue #36: Standard printed table of contents

Standard detects bounded printed TOC pages, obtains schema-validated titles,
hierarchy and printed labels from the captured index role, and resolves them
against original lines. Label matches still require an original heading;
missing/offset labels permit only a unique original match within a 32-page
repair bound. Mapping ambiguity, unsupported title, ordering and schema errors
remain failed outcomes. Shared construction, refinement, summaries and guarded
publication preserve front matter and inclusive physical boundaries.

Ran: production build, typecheck, 6 Bun tests and the Standard Playwright
vertical scenario with real PostgreSQL/public HTTP. TOC Arabic labels 1/3/5
mapped to physical 3/5/7; original viewer opened physical page 3. Unit cases
cover Roman metadata, bounded repair, absent/ambiguous titles. Controlled schema
failure cannot publish. All passed. Saved artifact/protocol evidence is in
`docs/evaluation/pageindex-standard-toc.json`.

The isolated fixed Python reference's physical validation/offset helpers and
shared tree validator accept this result (no structural issues; offset 2),
recorded in `pageindex-standard-reference.json`. This is helper/artifact
comparison, not a complete upstream model pipeline or real-model quality
measurement. Those measurements remain unrun pending the user's later
connection and are tracked by #47. No fallback to Flash or another provider;
no commit/push made.
