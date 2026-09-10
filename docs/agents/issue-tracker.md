# Issue tracker: GitHub Issues

The user requested migration to `L-1ngg/loreweave` GitHub Issues on 2026-09-10.
Start at the [construction specification](https://github.com/L-1ngg/loreweave/issues/1)
and its 19 sub-issues. The [local navigation map](../../.scratch/rag-v1/README.md)
links the original work-item numbers to their GitHub issues.

Repository retirement [#19](https://github.com/L-1ngg/loreweave/issues/19) is work
item 00 and blocks the first product slice, #2. Its acceptance evidence concerns
the repository baseline; application behavior begins with #2.

- The specification issue owns product scope and numbered acceptance outcomes.
- Each work-item issue owns its acceptance criteria, status and execution evidence.
  Native sub-issues record the parent; native blocked-by relationships and the
  issue's `Blocked by` field record dependencies. Update both when dependencies change.
- Repository modules and shared contracts own callable behavior and invariants.
  Local spec/ticket files in `.scratch/rag-v1` are historical migration snapshots.
  Refine current scope in GitHub and update affected module contracts together.
- `ready-for-agent` means scoped and reviewable, including tickets with blockers.
  Start when implementation is requested and the blockers have completion evidence.
  Record `in-progress` or `blocked` in the issue body while working. On completion,
  record checks and limits, set the body status to `complete`, remove readiness
  labels and close the issue. GitHub open/closed state records completion.
- `spec` identifies the parent and `work-item` identifies delivery slices.
  Incoming triage may use `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, or `wontfix` as needed. Create labels when first used.
- Routine design/decomposition choices remain delegated; changes to confirmed
  product behavior must be explicit in the specification and decision record.
- Forge integration defect reports use the separately authorized upstream tracker.

Before implementation, read the live issue, parent specification, named module
contracts and blockers' completion evidence. Afterward, record verification and
limits in the issue's Evidence section and link the implementation commit or PR.
Complete the specification only when all required acceptance outcomes have evidence.
