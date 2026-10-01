# Contributing

Start with [local setup](README.md#start-locally), the [module overview](docs/architecture/overview.md)
and the affected [contracts](docs/architecture/contracts.md). Use the installed
Bun toolchain and locked dependencies. Development commands, model traffic and
output locations are described in [testing](docs/development/testing.md) and
[evaluation](docs/development/evaluation.md).

## Work tracking

[GitHub Issues](https://github.com/L-1ngg/loreweave/issues) own requirements,
acceptance criteria, dependencies, status and execution evidence. The current
product specification is [Spec #29](https://github.com/L-1ngg/loreweave/issues/29).
For a work item, read its parent specification, relevant contracts and blockers'
completion evidence before implementation. Confirmed scope takes precedence over
a readiness label.

Use native sub-issue and blocked-by relationships alongside the item's dependency
description. `spec` identifies product specifications and `work-item` identifies
delivery slices. `ready-for-agent` means scoped and reviewable, even with blockers.
Record `in-progress` or `blocked` while executing. Completion requires the item's
acceptance evidence, checks and limits, a commit/PR reference when available,
`complete` status, removal of readiness labels and issue closure. A parent spec
is complete only when all required outcomes have evidence.

Local drafts belong in ignored `.scratch/`. Once published, refine the live issue
rather than keeping a second ticket/spec copy in the repository. Earlier issue
graphs are [historical context](docs/history.md), not current execution gates.

## Documentation ownership

| Location             | Owns                                                          |
| -------------------- | ------------------------------------------------------------- |
| `README.md`          | Product introduction and local startup                        |
| `docs/README.md`     | Navigation by reader purpose                                  |
| `docs/guides/`       | Current user workflows                                        |
| `docs/architecture/` | Current implementation, interfaces and invariants             |
| `CONTEXT.md`         | One domain glossary, limited to terms and meanings            |
| `docs/adr/`          | Architectural choices, trade-offs and supersession            |
| `docs/development/`  | Configuration, testing and evaluation methods                 |
| `docs/evaluation/`   | Reviewed, dated result reports                                |
| `tests/fixtures/`    | Reusable test inputs, source facts and checksum manifests     |
| GitHub Issues        | Scope, acceptance criteria, work plans and execution journals |

Update the existing topic when behavior changes. Create a new document only for a
distinct reader need and link it from the index. Completing an issue does not
require a new document. Current architecture describes implemented behavior;
future changes stay in their issue until implemented. Record an ADR when a choice
has a lasting trade-off, keeping existing IDs stable and marking superseded choices.

Documentation uses English; UI copy and user-facing project discussions use
Simplified Chinese. Keep source identifiers unchanged. Preserve license notices
and pinned attribution when consolidating or retiring material. Historical detail
is accessible through fixed Git revisions; the current tree keeps a short history
entry instead of reproducing retired design and execution archives.

## Verification and artifacts

Run the applicable checks in [testing](docs/development/testing.md). Report
`Ran / Not run / Why / Risk`; controlled providers and lexical assertions do not
establish real-model answer quality. Paid commands require an explicitly supplied
private provider file and budget. Runtime credentials and private data remain
outside committed documentation and evidence.

Tests and evaluation commands write to ignored run directories or an explicit
external output directory. Preserve tracked documents and fixed test inputs.
Raw outputs, screenshots, call/cost logs, delivery manifests and execution
snapshots stay outside Git. Archive a run's complete evidence dependency set
externally, including failures and rejected inputs, and record source/dataset/
provider identity and checksums there. Publish only a concise, reviewed result
report with provenance and limitations; task execution evidence stays in its issue.

`bun run check:docs` verifies local targets, heading anchors, navigation coverage
and document placement, including accidental tracked evaluation outputs.
`bun run fixtures:verify` checks fixed PDF input hashes. CI also checks that
validation leaves tracked files unchanged. Temporary
files are removed after use; `.archify` artifacts and unrelated user work are
preserved.
