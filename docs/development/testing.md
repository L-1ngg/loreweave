# Testing

Use Bun 1.3.12 for application tools and Node 24 for the installed persistence
Vitest testkit. PostgreSQL 17 and Chromium are required for integration checks.
Start with [local setup](../../README.md#start-locally); package scripts are the
executable command source.

## Check layers

| Command                    | Checks                                                | External requirements / output                     |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `bun run typecheck`        | Strict application, scripts and test types            | Installed dependencies                             |
| `bun run format:check`     | Code and authored documentation format                | Frozen evidence is excluded                        |
| `bun run check:docs`       | Local targets/anchors, navigation and placement       | No network calls                                   |
| `bun run fixtures:verify`  | Fixed PDF input SHA-256 identities                    | No model calls                                     |
| `bun run test`             | PDF/layout/tree, schemas, bounds and output isolation | Controlled/local only                              |
| `bun run test:conformance` | PostgreSQL MessageStore/RunStore SDK contracts        | Disposable real PG database, Node 24               |
| `bun run build`            | Compiled Start/Bun app and client bundles             | Replaces `dist`; coordinate with a running service |
| `bun run check:baseline`   | Compiled HTTP/SDK integration probes                  | PG, built app and Chromium; ignored run output     |
| `bun run test:browser`     | Public Web/MCP behavior on desktop/mobile             | PG, built app and Chromium; ignored results        |

For a fresh checkout, install Chromium with `bun x playwright install chromium`;
CI also installs its operating-system dependencies. Build before baseline/browser
checks. Browser checks create an isolated database and original directory and
remove them through teardown. The controlled provider overrides both model roles;
these commands do not execute the owner's paid connection.

## Integration probes

[probe-baseline.ts](../../scripts/probe-baseline.ts) exercises compiled Bun Start,
protected SSR/server functions, Query hydration, Form, a real PostgreSQL read,
multipart PDF extraction, exact original GET/HEAD/Range, SDK SSE, tool/structured
output, zero-observer execution, same-run replay, explicit cancellation, official
MCP client and server-only bundle separation. It writes measured output into an
ignored run directory.

The browser suite exercises actual document/QA workflows, retries, version
updates, retirement/history, revocation, conversations, refresh/navigation/closure,
Stop and process interruption. Desktop/mobile original canvas checks test more
than element presence. Public checks cannot be replaced by server-only calls.

Persistence conformance enables this application's MessageStore/RunStore
capabilities. Optional skips concern unrelated interrupts, generic metadata,
generation runs, artifacts/blobs and reclaim/parent-run listing. Required message
metadata and thread/run history are included.

## Results and boundaries

Routine checks preserve all tracked files and fixed test inputs. CI verifies
this after the suite. Per-task `Ran / Not run / Why / Risk` belongs in the live
issue; dated reviewed results belong in [evaluation](../evaluation/pageindex-v1.md).

Controlled fixtures establish protocol, scope and lifecycle behavior. Real model
compatibility, citation semantic support and cost/latency require separate
[evaluation](evaluation.md). A lexical substring assertion or valid citation
location is not a semantic quality score. Report browser engines, provider profiles
and optional skips actually covered by the run.
