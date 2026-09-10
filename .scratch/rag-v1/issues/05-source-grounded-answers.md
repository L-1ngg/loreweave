# 05: Answer fact questions from hybrid original-source retrieval

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/6)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

**Status at migration:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 04

**Modules:** M02, M06, M07, M09

**Spec outcomes:** AC05, AC13

## What to build

Members ask fact/rule questions and receive source-supported answers and clickable citations using lexical/vector retrieval.

## Acceptance criteria

- [ ] Fuse lexical and original-content vector candidates with RRF under trusted scope; test Chinese, English identifiers and paraphrases.
- [ ] Assemble a deduplicated evidence pack and finalize with tools disabled under the same run budget.
- [ ] Preserve conditions and source conflicts; correctly distinguish unavailable evidence from an unsupported definitive answer.
- [ ] Reject fabricated citation handles and verify the supporting passage's source version before delivery.
- [ ] Expose per-run timing, request counts and evidence diagnostics for development without claiming the final capacity target.

## Verification boundary

Answer interface and browser citation navigation with real retrieval fixtures and a scripted generator.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
