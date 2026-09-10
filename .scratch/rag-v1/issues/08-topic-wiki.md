# 08: Publish cited cross-document topic Wiki pages

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/9)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 06, 07

**Modules:** M02, M03, M05, M06, M08, M09

**Spec outcomes:** AC08, AC05

## What to build

Overlapping source documents produce browsable topic pages with original citations, and eligible Wiki content helps locate answer evidence.

## Acceptance criteria

- [ ] Create/update topic candidates across multiple sources with shared/project scope and entity links.
- [ ] Check source references, support, qualifiers and visible known conflicts; publish passing candidates without routine human approval.
- [ ] Use one generation plus at most two persisted repair attempts; show candidate failure without replacing an effective page.
- [ ] Publish related page pointers and navigation atomically after checking expected dependencies.
- [ ] Retrieve eligible Wiki content alongside sources and deduplicate shared original evidence; a pending embedding projection can fall back to originals.

## Verification boundary

Import-to-Wiki browsing and Wiki-assisted answer flow with scripted maintenance model and publication failure cases.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
