# 10: Merge, split and restore Wiki pages with traceable navigation

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/11)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 09

**Modules:** M05, M06, M08, M09

**Spec outcomes:** AC10

## What to build

Members request topic reorganization or restoration and can follow old page entries and historical citations after the edit.

## Acceptance criteria

- [ ] Apply same-topic/scope merge and independently readable-topic split rules; avoid title-only or length-only decisions.
- [ ] Publish a related edit set atomically, retaining redirect/listing entries and historical source/page references.
- [ ] Restore past content or an edit set as new versions and preserve later unrelated edits and the user's rationale.
- [ ] Revalidate restored source/identity dependencies; mark stale restored content pending and exclude it from current evidence.
- [ ] Return a focused clarification if an intervening edit makes the intended recovery ambiguous.

## Verification boundary

Browser page/history/navigation with concurrent edit-set publication and current-source restoration cases.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
