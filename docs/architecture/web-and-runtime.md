# Web and runtime

The application uses TanStack Start/React with Router, Query, Form and AI React,
served under Bun. Exact dependency versions live in [package.json](../../package.json)
and [bun.lock](../../bun.lock). This document records the integration boundaries
and version-sensitive details to recheck when upgrading.

## Responsibilities

| Component      | Owns                                                        | Application responsibility                                 |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Start          | Server composition, server functions and raw routes         | Trusted context, transactions and lifecycle                |
| Router         | Working views, deep links, search and return navigation     | Authorized view state and source targets                   |
| Query          | Metadata/status caches, pagination and SSR hydration        | Identity-aware keys, invalidation and access               |
| Form           | Login, settings and import input state                      | Shared schemas, server validation and secrets              |
| AI / AI React  | Model/tool loop, structured output and message presentation | Scope, original evidence and run ownership                 |
| AI persistence | MessageStore/RunStore contracts and middleware              | PostgreSQL implementation and durable product transactions |
| AI MCP         | Streamable HTTP tools/resources and sessions                | Token authorization and shared reading adapters            |
| Intent         | Installed package development guidance                      | Selecting current skills and reviewing mappings            |

PostgreSQL/Drizzle own durable server data. Query and AI React have different
presentation responsibilities but neither supplies another writable transcript.
TanStack DB is a client reactive data layer; the current application has not
adopted it, Table or Virtual as additional runtime requirements.

## HTTP boundaries

Ordinary Web reads and commands use protected Start server functions. The
[contracts](contracts.md#m06-web-and-mcp-boundaries) enumerate actual raw routes:
multipart import/update, immutable PDF GET/HEAD/Range, SDK SSE and MCP. They
preserve native headers, status and response bodies. Server access/input checks
apply to both function and route transports.

The composition root uses the official Start Fetch handler under `Bun.serve`.
It serves built assets and preserves occupied ports. Start's request cancellation
belongs to the observer; accepted model/indexing work has its own process-owned
controller. Public probes exercise compiled Bun, not only Vite development.

## Cache, history and private state

SSR creates a QueryClient per request with official Router/Query hydration.
The browser router retains its client across navigation. Cache keys include
document/source/index and conversation identities. Mutations invalidate or update
the affected metadata. Server authority checks apply even when cached data exists.

Canonical transcript/run state stays in PostgreSQL. AI React owns the active
message/stream presentation. Server history is a hydration snapshot, not a second
Query/DB message collection. Reattachment reconciles stable IDs. Logout/session
loss clears private query and AI presentation state.

API keys and newly created MCP tokens have transient form/display state only.
Saved plaintext, database handles and internal storage paths do not enter SSR
dehydration, client bundles, persistent caches or recorded public provenance.

## Observed adapter details

- A direct sliced `BunFile` response failed exact Range-byte probes. The original
  route materializes the requested slice before constructing its response.
- PDF.js 6 uses loading-task `destroy()`; removed options such as `isEvalSupported`
  are not part of the current extractor interface.
- TanStack structured output can use a streaming wire path even with awaited
  `chat({ outputSchema })`. The controlled provider implements that actual path.
- `@tanstack/ai-mcp` 0.6.0 omits URI/request context from resource callbacks.
  [mcp.ts](../../src/server/mcp.ts) uses a request-scoped AsyncLocalStorage bridge
  for the verified actor and resource URI; the maintained SDK still owns transport
  and sessions. This is not a parallel HTTP runtime.
- Accepted-run delivery uses the maintained SDK memory log/replay responses;
  an iteration's finish event is not necessarily final producer closure.

See [testing](../development/testing.md#integration-probes) for the checks required
to keep these boundaries valid.

## Intent

Use the installed CLI through the root scripts:

```sh
bun run intent:list
bun run intent:load @tanstack/ai#ai-core
```

Start's transitive devtools dependency also claims the `intent` executable. With
the locked versions, generic `bun x @tanstack/intent` resolved that conflicting
entry. The root scripts select `node_modules/@tanstack/intent/dist/cli.mjs`
explicitly. Discover actual skill identifiers before loading; use installed source
and official version-appropriate documentation when guidance is missing or stale.

When regenerating mappings, run the same CLI with `install --dry-run`, review the
result and preserve project rules before applying it. Intent is development
guidance and does not load skills into the application's model at runtime.
