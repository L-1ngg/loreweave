# Issue tracker: GitHub Issues

Use [Spec #29](https://github.com/L-1ngg/loreweave/issues/29) for the current
PageIndex-style replacement, then [the construction blueprint](../pageindex-v1-blueprint.md)
and the selected live work item. The [ticket plan](../design/pageindex-v1/tickets/README.md)
initially contains review/publication drafts; after publication it links live items.
Draft IDs are not GitHub issue numbers or execution status.

Issues #1-#28 and the [old local navigation map](../../.scratch/rag-v1/README.md)
are superseded historical records. Their old sub-issue/dependency graph and
readiness do not gate or define the new replacement.

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
- Old Forge integration evidence belongs to the historical scope; the replacement
  uses its current specification and tracker rather than recreating old work items.

Before implementation, read the live issue, parent specification, named module
contracts and blockers' completion evidence. Afterward, record verification and
limits in the issue's Evidence section and link the implementation commit or PR.
Complete the specification only when all required acceptance outcomes have evidence.
