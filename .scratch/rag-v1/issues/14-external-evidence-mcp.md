# 14: Expose organization-scoped evidence and answers through MCP

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 05

**Modules:** M01, M06, M07, M09

**Spec outcomes:** AC02, AC14

## What to build

An external Agent with an organization credential retrieves original evidence and cited answers without using the browser conversation.

## Acceptance criteria

- [ ] Expose stable evidence-search and question-answer operations backed by the same scope/validity interfaces as the browser.
- [ ] Validate external credential grants and reject writes through read-only credentials.
- [ ] Return immutable citation handles, applicability information and gaps in a structured response.
- [ ] Keep external request context explicit and isolated from unrelated browser conversations.
- [ ] Verify revocation, project/shared filtering and source-update validity parity with browser requests.

## Verification boundary

Real MCP client/server interaction against the controlled source corpus and same domain interfaces.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
