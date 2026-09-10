---
status: accepted
date: 2026-09-10
---

# Embed Forge Agent through its SDK in a Bun backend

Under the component-selection delegation in Q37 and Forge reuse direction in
Q38, use a pinned source snapshot of `@forge-agent/core/sdk` as the execution
foundation and TypeScript/Bun for the redesigned backend. This supersedes the
assistant's Python/FastAPI and custom-loop defaults. The Markdown-only workload
does not currently need Python-specific processing, and in-process typed tools
avoid the transport and lifecycle work of a separate Bun Agent service.

Forge owns its loop, tool scheduling, session mechanics and context management.
My-RAG owns the host, knowledge tools, PostgreSQL storage adapter, organization
authorization, domain-operation idempotency, evidence validity and cumulative
budgets. Direct SDK reuse preserves tested lifecycle behavior; porting the loop
would create a second implementation to maintain. A Bun dependency and a pinned
vendor/patch workflow are the resulting trade-offs, since the SDK is a private
workspace package with no npm distribution or Node/Python compatibility promise.

The [reuse investigation](../research/forge-agent-reuse.md) records the inspected
revision, alternatives, fresh tests and known integration gaps. Source adoption
and local patches are implementation work, not completed by this decision.
