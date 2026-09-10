# 16: Build reproducible evaluation over public answer interfaces

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 05

**Modules:** M06, M09

**Spec outcomes:** AC16

## What to build

A maintainer runs a versioned development corpus through the public answer interface and obtains per-case evidence, quality labels, latency and cost records.

## Acceptance criteria

- [ ] Load a source/version manifest and separate development/acceptance dataset schemas with reviewed reference passages and expected gaps.
- [ ] Provide the source-only/Wiki/graph/combined configuration controls; unavailable routes are explicitly reported until their tickets complete.
- [ ] Report per-category pass counts, actual citation checks, completion status, timings, request/token use and available monetary cost.
- [ ] Keep generated benchmark answers out of indexing/maintenance input and prevent holdout-driven tuning.
- [ ] Provide a small executable controlled-provider fixture and clear preparation steps for the delegated 50-development/200-acceptance sets.

## Verification boundary

Evaluation command or equivalent host runner calling public answer behavior; verify report correctness with known good/bad fixture answers.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
