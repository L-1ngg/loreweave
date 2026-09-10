# 09: Refresh Wiki after source changes and natural-language corrections

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/10)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 08

**Modules:** M02, M03, M05, M06, M08, M09

**Spec outcomes:** AC09, AC11

## What to build

A source change or correction updates relevant topics while users can still browse marked pending pages and get answers from valid originals.

## Acceptance criteria

- [ ] Persist factual contributions as attributed source notes and organization preferences as retained guidance with actor/scope.
- [ ] Coalesce affected maintenance work and verify the latest source/identity dependencies before publication.
- [ ] Immediately bypass stale pages using authoritative dependency checks while refresh is queued/running/failed.
- [ ] Display unresolved conflicting claims with both sources and preserve applicable shared/project distinctions.
- [ ] Retry bounded failures without resetting repair attempts and expose source-searchable/Wiki-ready statuses separately.

## Verification boundary

Natural-language correction and source-update flows through page status, cited answers and durable maintenance.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
