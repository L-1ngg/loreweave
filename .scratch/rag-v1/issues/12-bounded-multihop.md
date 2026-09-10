# 12: Answer multi-hop questions with bounded adaptive retrieval

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 08, 11

**Modules:** M03, M04, M05, M06, M07, M09

**Spec outcomes:** AC05, AC07, AC13

## What to build

Members ask cross-entity questions; the Agent searches graph evidence immediately, fills identified gaps and returns a cited answer within its original budget.

## Acceptance criteria

- [ ] Combine source, Wiki and graph evidence without double-counting passages or inventing transitive responsibility/causation.
- [ ] Use initial plus bounded follow-up rounds directed at specific missing evidence; enforce the per-call graph caps.
- [ ] Prevent all further retrieval during finalization and enforce cumulative task/retry/summary requests before dispatch.
- [ ] Return supported partial results and explicit missing coverage when limits are reached; score incomplete answerable questions accordingly.
- [ ] Demonstrate a person/project/database question with one initially missing project fact and a source conflict.

## Verification boundary

Browser question through real module interfaces with a scripted multi-call provider and observed request/effect limits.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
