# 13: Resolve natural-language source and Wiki requests across turns

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 06, 09

**Modules:** M01, M02, M05, M07, M08, M09

**Spec outcomes:** AC11, AC12

## What to build

Members use phrases such as 'update that project's manual' or 'keep the old step structure' across turns without supplying internal IDs.

## Acceptance criteria

- [ ] Resolve intent from the current project, selected document/page, attached file and durable conversation context.
- [ ] Execute clear new/update/correction requests once; ask only when a necessary target or effect is ambiguous.
- [ ] Keep explicit new-document intent distinct from same-filename updates.
- [ ] Retain organization guidance and restoration reasons as maintenance input, while source instructions cannot grant tool authority.
- [ ] After reconnect/restart, inspect the durable operation outcome instead of resubmitting a previous change.

## Verification boundary

Multi-turn browser interactions with duplicated filenames, cross-project ambiguity and restart after effect-before-result.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
