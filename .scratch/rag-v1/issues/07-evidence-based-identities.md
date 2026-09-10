# 07: Resolve entity identities with inspectable source evidence

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 04

**Modules:** M02, M03, M08, M09

**Spec outcomes:** AC06

## What to build

Members can distinguish same-named project objects and inspect why source mentions are linked to a shared identity.

## Acceptance criteria

- [ ] Extract/record source mentions separately from canonical identities and scoped reliable identifiers.
- [ ] Use explicit source equivalence or sufficient identifier evidence for automatic unification; leave name/similarity-only candidates distinct.
- [ ] Expose source-backed identity explanations through source/answer context without requiring a dedicated graph editor.
- [ ] Accept an unambiguous evidenced identity correction, preserve mentions and increment the resolution revision.
- [ ] Return affected dependency information for downstream invalidation; no graph extraction completion is required for identity resolution.

## Verification boundary

Public identity commands/queries with same-name, explicitly shared and corrected-merge fixtures.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
