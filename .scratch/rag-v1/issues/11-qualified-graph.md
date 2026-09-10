# 11: Retrieve source-backed qualified graph relationships

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 06, 07

**Modules:** M02, M03, M04, M06, M08, M09

**Spec outcomes:** AC07, AC09

## What to build

A relationship question can inspect a supported entity connection, its qualifiers and original passages, even while unrelated knowledge is still updating.

## Acceptance criteria

- [ ] Extract original-source relationships with direction, applicability, time/environment, plan/negation and conflict metadata.
- [ ] Store separately supported claims and expose their sources; do not derive factual edges from generated Wiki prose.
- [ ] Retrieve bounded applicable neighborhoods and report caps/pending coverage without treating missing edges as negative facts.
- [ ] Exclude support invalidated by source activation or identity correction immediately, retaining other independently valid support.
- [ ] Expose a relationship-backed answer and citation path through the existing product answer flow.

## Verification boundary

Question-to-neighborhood-to-original-citation flow with planned, negated, conflicting and stale claims.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
