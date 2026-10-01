# TanStack Web, Runtime and Development Integration

Status: implemented integration, 2026-10-01; locked packages and compiled-Bun
probes are recorded in [baseline evidence](../../development/pageindex-baseline.md).
This incorporates the user's instruction to prefer
suitable TanStack libraries and Intent throughout the replacement. Product scope remains
[Spec #29](https://github.com/L-1ngg/loreweave/issues/29); [M06](contracts.md#m06-web-and-mcp-interfaces)
owns the adapters and [M05](contracts.md#m05-knowledge-runs-and-conversations)
owns accepted Knowledge runs.

## Selected responsibilities

Use TanStack Start with React 19+, Router, Query and Form for the Web application.
Keep Bun, Vite, PostgreSQL and Drizzle. Start replaces the default independent
Hono application entry. Compose the six domain modules in one local process;
the runtime adapter supplies lifecycle/startup and delegates requests to Start.

| Library         | Responsibility                                                                             | Application-owned contract                                                      |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Start           | React/server composition, server functions, raw server routes                              | Authentication context, transactions and process lifecycle                      |
| Router          | Working views, document/conversation deep links, search parameters and return navigation   | Authorized view state, citation targets and reading position                    |
| Query           | Library/conversation/settings metadata, index status, pagination, preloading and hydration | Cache keys, invalidation and current access/eligibility                         |
| Form            | Login, model connections, role defaults and import settings                                | Input schemas, server validation and secret handling                            |
| AI and AI React | Model/tool execution, structured outputs, streamed message presentation                    | Scope, page-read evidence, canonical history and run ownership                  |
| AI persistence  | Maintained MessageStore/RunStore contracts and middleware                                  | Drizzle adapter, durable acceptance and final-result transactions               |
| AI MCP          | External Streamable HTTP server, tools and resources                                       | Token verification and shared authorized reading services                       |
| Intent          | Package-owned development skills and agent task mappings                                   | Selecting/loading version-matched guidance and reviewing generated instructions |

These headless libraries supply behavior; M06 still implements the product's
working views and accessible controls. PDF extraction/tree inference, immutable
publication, authorization, citation evidence and bounded background work remain
behind M01-M05. The application reuses maintained primitives wherever they meet
those contracts.

Consider additional TanStack packages when they remove actual code:

- DB/Query collections for required reactive joins or collection synchronization
  that would otherwise need a separate client state layer.
- Table for substantial document-list sorting, filtering or column behavior.
- Virtual for measured long-message, tree or page-list rendering needs, with
  dynamic height, citation return and scroll anchoring checked.
- Devtools for local diagnosis, excluded from the delivered production bundle.

DB is a reactive client store for API data. PostgreSQL/Drizzle remain the durable
server database. The current single-owner, server-authoritative scope does not
require another writable transcript collection. Record an adoption's purpose
and version evidence in its work item; installing every ecosystem package is not
a completion criterion.

## HTTP and server functions

Ordinary internal Web reads and commands use Start server functions with shared
schemas and server-derived authorization. Query calls those functions for
reads; forms/mutations invoke commands and update or invalidate affected caches.
Public-boundary checks exercise the resulting HTTP/browser behavior rather than
only calling a domain service in a test.

Use raw Start server routes for interfaces that require native HTTP semantics:

| Interface          | Required behavior                                                              |
| ------------------ | ------------------------------------------------------------------------------ |
| PDF upload/update  | Multipart bytes and durable operation acceptance                               |
| Immutable original | Authorized GET/HEAD, Range/status/content headers and the bound source version |
| Run delivery       | SDK SSE Response, timely first output, replay cursor and reader detach         |
| MCP                | SDK-supported GET/POST/DELETE and unchanged protocol Response                  |

The ordinary command/query URLs in [contracts](contracts.md) describe logical
operations, not a requirement to recreate REST handlers beside equivalent server
functions. Keep the raw upload/original/SSE/MCP endpoints explicit. Apply access
and input checks to both transports; never serialize database handles, model
credentials or internal artifact paths to a browser.

Create one shared MCP server instance in the composition root. After current
token verification, pass the trusted auth/context to its supported
`handle(request, options)` and return its Response. Recheck access on subsequent
session calls and resources. M04 tools remain shared with in-process QA.

## Cache and transcript ownership

Create a QueryClient per SSR request and use the official Router/Query hydration
integration. The browser router keeps its client across navigation. Protected
responses and dehydrated data follow current owner/session authorization; clear
private query and AI presentation state on logout/session loss. Use explicit
document/version/index identities and conversation IDs in cache keys.

Query owns server-data caches and conversation metadata. AI React owns the active
conversation's message/stream presentation. Canonical messages and run outcomes
remain in M05/PostgreSQL. A transcript fetched for hydration is an input snapshot,
not another independently writable message list in Query or DB. Reconcile stable
message/part identities when attaching to the saved run.

Uploads, retries, source activation/retirement, settings changes and conversation
commands update or invalidate relevant Query state. Authoritative server guards
still enforce current eligibility, immutable references and active-run deletion
rules. Cached content does not authorize a new read or broaden query scope.

Form manages local input state and validation while the server validates again.
API keys and newly issued MCP tokens have transient input/display state only;
they are excluded from persistent client collections, dehydrated caches and logs.

## Accepted-run lifetime

Start accepts raw streaming Responses but its request context carries the
browser's `Request.signal`. That signal controls an attachment, not accepted
model/indexing work. M05 commits acceptance first and dispatches one producer
with its own controller, even with zero observers. AI React teardown/navigation
must not issue the product Stop command.

Use the installed SDK's supported replay/stream primitives and official client
connection surface. A small transport adapter may connect saved-run hydration
and attachment to AI React; do not add another Agent loop or stream protocol.
Explicit Stop records intent and cancels the owned producer. Restart restores
committed history and marks unfinished work interrupted without model replay.
The full invariant remains in [QA and streams](qa-and-streams.md).

## Bun and integration gates

Official Start guidance supports Bun with React/React DOM 19+. Prefer the
official Bun integration/reference with minimal local composition code. The
Nitro Vite integration is under active development; use it only with a locked,
tested version when it reduces adapter work. A local compiled-runtime smoke
check is required even though application deployment packaging is deferred.

P01 resolved and locked the measured compatible set. Installed versions are
Start 1.168.60, Router 1.170.41, Query
5.104.0, Form 1.33.5, AI 0.63.0, AI React 0.29.3, MCP 0.6.0, persistence 0.7.1
and Intent 0.5.0; React 19.3.0, Vite 8.2.2 and PDF.js 6.3.289 are also locked.
Start's published Node engine is >=22.12.0 and Vite peer is >=7.0.0; official Bun
guidance is a separate supported runtime path. Record actual tooling/runtime
versions: `bun run dev` alone does not prove that a Node-shebang tool ran on Bun.

P01 checks the minimal integration boundary; later slices verify completed
workflows. Required probes cover:

1. Local dev, build and compiled Bun entry; SSR, a protected server function,
   Query hydration and exclusion of server secrets/modules from the browser.
2. Multipart fixture upload, authorized PDF GET/HEAD/Range and SSE first-output
   timing without adapter buffering.
3. Controlled tool/structured-output calls, persistence conformance shape,
   zero-observer production, existing-run replay and explicit cancellation.
4. A minimal official MCP-client initialization/tool call through Start;
   P13 supplies all reading resources, revocation and required method checks.
5. Version-matched Intent discovery/loading and reviewed agent mappings.

If a selected adapter fails a required probe, record the failing behavior and
choose a maintained compatible adapter. Retain Hono only for a demonstrated
transport requirement that Start cannot satisfy; document the evidence and
narrow responsibility before carrying a second HTTP stack.

## Intent workflow

During P01, use the local Intent development dependency, lock its compatible
version with the runtime packages and expose repeatable root script entries.
After installing the selected packages, use the project-local CLI to discover
their shipped skills:

```sh
bun x @tanstack/intent list
bun x @tanstack/intent install --dry-run
bun x @tanstack/intent install
bun x @tanstack/intent load @tanstack/ai#ai-core
bun x @tanstack/intent load @tanstack/ai-persistence#ai-persistence
bun x @tanstack/intent load @tanstack/ai-mcp#ai-mcp
```

Inspect the dry-run before applying its generated task mappings to AGENTS.md;
preserve the project's existing rules. Use discovery for the actual Start,
Router, Query and Form skill identifiers instead of inventing them. Load only
guidance relevant to the active work, with an explicit allowlist when supported.
When a package lacks a skill or its guidance is stale, read its installed source
and official version-appropriate docs. Recheck mappings after dependency updates.

Intent distributes development guidance. It is distinct from `@tanstack/ai-skills`,
which would load skills for the application's model at runtime; no such product
feature is introduced here. Intent 0.5.0 is a local development dependency.
P01 applied the mappings after reviewing install --dry-run and preserving
project guidance. `bun run intent:list`/`intent:load` select its own CLI because
Start's transitive dependency also claims the `intent` executable.

## Sources and evidence boundary

- [Start server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)
  and [server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions).
- [Start Query integration](https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query).
- [Start Bun hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#bun)
  and [official Bun example](https://github.com/TanStack/router/tree/main/examples/react/start-bun).
- [Start request signal implementation](https://unpkg.com/@tanstack/start-server-core@1.169.39/src/createStartHandler.ts).
- [MCP Request/Response interface](https://unpkg.com/@tanstack/ai-mcp@0.6.0/src/server/create-server.ts).
- [DB overview](https://tanstack.com/db/latest/docs/overview)
  and [Query collections](https://tanstack.com/db/latest/docs/collections/query-collection).
- [Intent source and CLI](https://github.com/TanStack/intent).

Official source, installed skills and Intent discovery were checked on
2026-10-01. Actual package/lifecycle, public HTTP, persistence and browser
evidence is recorded per work item; actual provider compatibility and semantic
quality are separately measured in #47.

Required local integration probes and complete desktop/mobile workflows now
have [final AC evidence](../../evaluation/pageindex-acceptance.md). Actual
configured endpoint/model behavior and limits are in
[the measured report](../../evaluation/pageindex-results.md). Server-only bundle,
private Query cleanup and ordinary server-function/raw-route boundaries pass;
no compatibility exception required an independent Hono runtime.
