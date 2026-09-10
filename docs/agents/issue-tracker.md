# Issue tracker: Local Markdown

Selected under the user's routine-design delegation for the construction
planning request on 2026-09-10, before this directory had a Git root or remote.
The repository is named LoreWeave (`L-1ngg/loreweave`). Publishing the repository
does not migrate the local work items to GitHub Issues; local Markdown remains
the tracker until a separate migration is requested.

- Specs live at `.scratch/<feature>/spec.md`.
- One independently executable work item lives in each
  `.scratch/<feature>/issues/<NN>-<slug>.md`.
- The feature README owns the dependency map and navigation. Tickets own their
  acceptance criteria and status; modules own callable behavior, not ticket state.
- `ready-for-agent` means scoped and reviewable. Begin only when implementation
  is requested and all `Blocked by` tickets are complete. Use `in-progress`,
  `blocked`, and `complete` as execution states and record evidence on completion.
- Use canonical triage roles `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, and `wontfix` for incoming requests when needed. Local status
  strings do not create remote labels.
- The user delegated routine design/decomposition choices. Refine local tickets
  directly within that scope; material product changes remain explicit decisions.
- Publication by a planning skill means creating these local files. Do not
  publish them to Forge Agent's tracker: that authorization covers relevant
  upstream integration issues, not this project's implementation backlog.

Before a ticket: read its parent spec, linked module contracts and blockers'
completion evidence. Afterward: record verification and limits, then update its
status. Do not close the parent spec merely because one ticket completes.
