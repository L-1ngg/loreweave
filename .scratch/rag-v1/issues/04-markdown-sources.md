# 04: Import Markdown and inspect versioned original passages

**Status:** ready-for-agent

**Parent:** [Construction specification](../spec.md)

**Blocked by:** 03

**Modules:** M02, M08, M09

**Spec outcomes:** AC03, AC11

## What to build

A member supplies Markdown through conversation/upload, sees processing readiness, then opens original passages through stable source references.

## Acceptance criteria

- [ ] Preserve original UTF-8 bytes and structured prose, lists, tables and fenced code; retain image links/alt text without image understanding.
- [ ] Create document identity independently of filename and store stable version/passage locators.
- [ ] Prepare lexical/vector records with a controlled embedding adapter before source activation, and commit activation plus maintenance work atomically.
- [ ] Retry the same accepted import by operation key without creating duplicate source identities or jobs; reject a changed payload under the same key.
- [ ] Expose processing, searchable and failure states with original passage viewing; failed preparation leaves no partially active source.

## Verification boundary

Browser import/status/source view with real PostgreSQL and controlled parse/embedding failures.

Read the [module map](../../../docs/design/rag-v1/README.md) and
[shared contracts](../../../docs/design/rag-v1/contracts.md), then the named
modules. Dependency completion means their relevant acceptance evidence is
available, not only that their files exist. Record actual checks, unrun portions
and material limits before completing this ticket.

## Evidence

Not started. This work item is a planning artifact, not a completed capability.
