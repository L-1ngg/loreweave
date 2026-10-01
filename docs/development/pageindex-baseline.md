# PageIndex construction baseline

P01's recoverable cleanup precedes every feature slice. See the
[retirement record](../history/pageindex-retirement.md) and the live
[work item #30](https://github.com/L-1ngg/loreweave/issues/30).

`pageindex-baseline-evidence.json` contains the measured compiled-Bun probe.
It covers Start SSR, Query hydration, Form submission to a protected server
function, a real PostgreSQL read, multipart PDF extraction, identical original
bytes, HEAD/Range, SDK SSE, two model/tool-loop calls with zero observers,
existing-run replay with zero added calls, structured output, an official MCP
client and exclusion of server modules/secrets from the browser bundle.
These package probes are not completed document/QA features or real-model
quality measurements. The in-memory MessageStore/RunStore contract probe is
followed by the real PostgreSQL conformance gate in P11.

## Locked runtime

Bun 1.3.12 and Node 24.14.1 were recorded. Dev and build invoke Vite through
Bun explicitly; the compiled app uses the official Start Fetch handler under
`Bun.serve`. No independent Hono entry is retained. The new local PostgreSQL
17 database is `loreweave_pageindex` on port 45434; its volume is independent
of all old `my-rag` volumes. Startup reads only `.pageindex.env` or the explicit
`LOREWEAVE_CONFIG_FILE`, plus `LOREWEAVE_*` environment variables.

The exact package set is in `package.json` and `bun.lock`: Start 1.168.60,
Router 1.170.41, SSR Query integration 1.167.3, Query 5.104.0, Form 1.33.5,
AI 0.63.0, OpenAI adapter 0.25.1, AI React 0.29.3, persistence 0.7.1,
MCP 0.6.0, Intent 0.5.0 and PDF.js 6.3.289.

## Observed integration details

- Start's `@tanstack/devtools-event-client` transitive dependency claims the
  `intent` executable. With Intent 0.5.0, `bun x @tanstack/intent list` therefore
  failed with `ERR_PACKAGE_PATH_NOT_EXPORTED: ./intent-library`. Root
  `intent:list`/`intent:load` invoke the installed package's own `dist/cli.mjs`.
  Its list, load, install dry-run and install all passed; existing AGENTS rules
  were preserved. Router/Query/Form packages that have no matching shipped
  entry skill are resolved against installed source and official guidance.
- A direct sliced `BunFile` Response returned more bytes than its Range header
  in the compiled Start/Bun probe. Materializing only the requested slice
  before returning the Response passed exact-byte checks. This stays within
  the Start raw route; it does not require another HTTP framework.
- PDF.js 6 uses the loading task's `destroy()` and no longer accepts
  `isEvalSupported`. The probe resolves against its installed declarations.
- The current AI core can use a combined streaming structured-output request
  even for `await chat({ outputSchema })`; the controlled provider implements
  this actual wire path. No adapter-specific output format is hand-written by
  the application.

## Reproduce

```sh
bun install --frozen-lockfile
bun run setup
docker compose up -d --wait postgres
bun run typecheck
bun run test
bun run build
bun run check:baseline
bun run check:docs
bun run dev
```

The fixture provider is explicit and loopback-only. Default construction
commands cannot read old model keys or execute paid calls. Full PostgreSQL
history, document indexing, model quality and complete desktop/mobile workflows
belong to their subsequent live issues and final AC report.
