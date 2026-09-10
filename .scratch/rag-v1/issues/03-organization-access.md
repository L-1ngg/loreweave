# 03: Apply organization access and project scope to knowledge operations

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/4)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 02

**Modules:** M01, M07, M09

**Spec outcomes:** AC02

## What to build

An administrator creates member access; members sign in and select project/shared scope that is enforced by the knowledge-operation entry points.

## Acceptance criteria

- [ ] Provide administrator bootstrap/member creation, password login, revocable browser sessions and operation grants.
- [ ] Keep login credentials distinct from conversation sessions and inject trusted actor/organization/scope into tools.
- [ ] Reject model attempts to replace the trusted actor or organization.
- [ ] Keep project classification a relevance filter while permitting applicable shared material; do not introduce project-member visibility ACLs.
- [ ] Verify revoked credentials and missing operation grants reject new operation admission.

## Verification boundary

Authenticated HTTP/browser operations with real persistence and forged tool-argument cases.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
