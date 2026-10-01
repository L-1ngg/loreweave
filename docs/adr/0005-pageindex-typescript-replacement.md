---
status: accepted
date: 2026-10-01
---

# Replace the knowledge-maintenance runtime with document-tree QA

The user selected a PageIndex-style TypeScript/TanStack AI replacement and
retired the earlier construction scope in Issues #1-#28. Keep Web conversations
and read-only MCP, with a single owner and local source startup; self-hosted
deployment packaging is deferred. [Spec #29](https://github.com/L-1ngg/loreweave/issues/29)
is the product authority and the [new blueprint](../pageindex-v1-blueprint.md)
defines construction details.

Use text-layer PDF originals, physical-page artifacts and a validated chapter
tree. Implement both Flash and Standard locally in TypeScript, defaulting to
Flash by user choice. Trees and summaries guide reading; original pages support
answers. Source references bind immutable version/page identity, so updates and
library retirement preserve authorized historical inspection.

Use TanStack's maintained model/tool loop, framework integration, persistence
contracts and MCP server instead of the Forge/Pi execution integration. Following
the user's ecosystem instruction, use TanStack Start/React 19+, Router, Query and
Form for HTTP/Web and Intent for package-owned development guidance. Retain Bun,
Vite, PostgreSQL and Drizzle; Start replaces the default independent Hono entry.
This removes parallel routing/cache/form foundations while keeping raw HTTP
routes for PDF/SSE/MCP. PDF layout/tree inference,
document/version publication, access and evidence identity remain application
responsibilities; adopting an SDK does not implement those contracts.

Query owns server-data caches and AI React owns message presentation, while
PostgreSQL remains the canonical source. Adopt DB/Table/Virtual when they remove
required application work; DB does not replace the server database. Start/Bun,
SSR hydration, raw transports and accepted-run lifetimes require P01 probes
before feature work. The [Web/runtime design](../design/pageindex-v1/frontend-and-runtime.md)
records the selection and evidence boundary.

This replaces ADR-0001 through ADR-0004 as active architectural requirements.
Shared source provenance, bounded work and remote-cancellation uncertainty
remain useful concepts, but the Wiki/graph/entity model, organizational scope,
old 30/60-second deadlines and eight-slot admission implementation are not
constraints on the new application.

The trade-off is substantial TS PDF/tree work, especially Flash geometry and
reading order, in exchange for removing maintained Wiki/graph/vector machinery
and the former Agent foundation. Use a fixed attributable PageIndex revision and
an isolated Python comparator to measure extraction and indexing; neither a
Python runtime sidecar nor the Cloud SDK satisfies the local TS requirement.

Before retiring the old implementation, preserve uncommitted work and data as
recoverable baselines outside the active repository and verify restoration.
The user selected cleanup before construction: P01 removes legacy source,
dependencies, checks, migrations and entry points before new feature work.
Retaining that executable tree until final acceptance would interfere with
search, repository checks and construction guidance. Use a fresh schema and
clean local entry; P18 verifies the finished replacement and absence of
reintroduced legacy paths. This decision records accepted direction; it is not
implementation, parser-parity, model-quality or deployment evidence.

## Implementation evidence

P01 completed the external archive, actual isolated restoration and early
retirement before feature construction. The locked Start Fetch handler runs
under Bun for both development and compiled local serving; raw multipart,
PDF Range, SDK SSE and MCP probes passed without retaining Hono.
`@tanstack/ai-mcp` 0.6.0's resource callback omits request context/URI, so the
MCP module uses a request-scoped AsyncLocalStorage bridge for the verified actor
and requested resource. The maintained server still owns transport and sessions.
This is an internal adaptation rather than a second HTTP runtime.

The [module map](../design/pageindex-v1/README.md) points to implemented exports,
and #30-#46 contain slice evidence. #47 records final AC coverage and measured
provider/reference results. These records keep controlled lifecycle guarantees
separate from semantic support measurements and from provider billing/remote
cancellation uncertainty.
