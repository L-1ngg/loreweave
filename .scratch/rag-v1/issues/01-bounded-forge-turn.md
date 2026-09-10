# 01: Run a bounded evidence-tool turn in the browser

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** None (can start immediately when implementation is requested)

**Modules:** M07, M06, M09

**Spec outcomes:** AC01, AC13

## What to build

A local development browser submits a question, observes a pinned Forge SDK calling a scripted evidence tool, and receives a cited fixture answer within a host-controlled budget.

## Acceptance criteria

- [ ] Import the pinned Forge workspace packages with required licenses/provider patch and reproducible dependency resolution; do not rely on a mutable upstream branch.
- [ ] Consume the SDK stream on the server and forward progress plus a distinct final product result to the browser.
- [ ] Count actual task, retry and summary requests before dispatch; enforce retrieval/finalization separation and preserve the deadline. Add a focused local SDK admission patch only if the public interface is insufficient.
- [ ] Demonstrate a valid evidence-tool answer, an exhausted budget and a canceled request with a local scripted model provider.
- [ ] Keep this bootstrap explicitly local/development-only until organizational access is delivered.

## Verification boundary

Browser-to-host behavior and real loopback provider request/effect counts. In-memory fixture storage is sufficient for this slice; persistent session guarantees belong to 02.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
