# 15: Recover interrupted maintenance without duplicate or stale effects

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 09, 10, 11, 13

**Modules:** M02, M03, M04, M05, M07, M08, M09

**Spec outcomes:** AC04, AC06, AC09, AC12, AC15

## What to build

After worker replacement or interrupted publication, users can inspect which changes committed and see valid knowledge recover without repeated writes.

## Acceptance criteria

- [ ] Persist operation outcome with domain effects and reject a worker whose lease/fence became obsolete.
- [ ] Reconcile outcome_unknown by durable operation key before scheduling any effect again.
- [ ] Supersede jobs derived from old source/identity revisions and preserve bounded generation/repair attempts across restarts.
- [ ] Keep current source/Wiki/graph eligibility correct during entity correction, failed refresh and interrupted edit-set publication.
- [ ] Show operation readiness separately from a timed-out Agent run, and verify settling work is still counted for execution admission.

## Verification boundary

Product operation/status-to-current-answer flow with real PostgreSQL failure points and process/worker replacement.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
