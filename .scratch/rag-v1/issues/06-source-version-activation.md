# 06: Update a document and switch current evidence atomically

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 05

**Modules:** M02, M06, M08, M09

**Spec outcomes:** AC04, AC09

## What to build

A member updates a selected document and sees current answers use the new effective source while prior citations remain readable.

## Acceptance criteria

- [ ] Resolve an explicit update to stable document identity and validate its expected prior version.
- [ ] Keep the previous version active while new parsing/embedding is pending or failed.
- [ ] Atomically activate the prepared revision and queue maintenance; reject superseded or conflicting late activation.
- [ ] Answer from current originals and preserve separate-source conflicts rather than last-upload-wins behavior.
- [ ] Change a source during answer generation: use at most one unused retrieval round within the original budget or report a gap, and record validated evidence versions.

## Verification boundary

Source-update-to-answer flow with concurrent activation, blocked preparation and finalization-time version changes.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
