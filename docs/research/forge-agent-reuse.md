# Forge Agent Reuse for My-RAG

Inspected: 2026-09-10. Design and controlled verification only; no Forge source
has been copied into My-RAG, no My-RAG runtime has been implemented, and no paid
provider request was made. The user authorizes using or referencing Forge Agent,
reporting encountered upstream problems as issues, and resolving integration
problems locally in My-RAG. This is a new focused investigation; the earlier
general RAG research remains historical.

## Decision

Reuse the public `@forge-agent/core/sdk` facade from a pinned source snapshot.
Run the redesigned backend on TypeScript/Bun so knowledge operations can be
ordinary in-process typed tools. My-RAG owns a small host module around the SDK;
it does not reimplement the model/tool loop or import runtime internals into
domain modules. Rationale is owned by
[ADR-0003](../adr/0003-forge-agent-sdk-and-bun-host.md).

| Approach | Assessment |
| --- | --- |
| Embed Forge SDK in a TypeScript/Bun backend | Selected: reuse current lifecycle behavior and tests with direct knowledge-tool calls |
| Keep a Python backend and run a Bun Agent service | Viable when Python-only knowledge processing is needed, but adds transport, distributed cancellation and deployment work without such a requirement in the Markdown-only first version |
| Port or independently rewrite the loop in Python | Loses direct reuse of Forge persistence, cancellation, tool-result and context semantics; creates a second implementation to maintain |

The user explicitly removed compatibility and reuse constraints for the old
My-RAG stack. The prior Python/FastAPI default is superseded; PostgreSQL/pgvector
and the confirmed product behavior remain suitable independent selections.
Python may still be used for separate evaluation tooling if useful.

## Verified source baseline

Local checkout `/home/l1ngg/dev/forge-agent` was clean before and after inspection.
Its HEAD and GitHub `master` both resolved to
`c5a4291def7f5346c428fe1c22d7b4d411742e23`. This is the inspected integration
baseline, not a promise to follow a moving branch.

- The SDK is a private Bun workspace export, not an npm-distributed package. Its
  `0.1.0` version alone does not identify compatible source behavior. [S1, S2]
- Current execution goes through `HostedAgent`, `AgentSession`, and the locally
  maintained `runtime/Agent`. Old `ExecutionCore` and `AgentRunner` internals
  have been removed. [S1, S3, S4]
- The SDK takes explicit host configuration and defaults to no coding tools or
  coding prompt. The host can supply custom knowledge tools. [S1, S3]
- Storage is injectable through `SessionStorage.load()` and `append(entry)`.
  Records contain stable IDs, parent IDs, message/compaction data and a selected
  leaf. Default storage is in-memory. [S5]
- Tools return `{ content, details, isError?, terminate? }`. `content` is model
  visible; `details` is host metadata and must be JSON-persistable. [S1, S6]
- Normal stream exhaustion and `turn.result` include the persistence completion
  boundary. A displayed `agent_end` event alone is insufficient. [S1, S3]

## My-RAG host responsibilities

The intended module surface is `startTurn`, `cancelRun`, and `observeRun`, plus
internal session construction/disposal. These are design names, not implemented
exports. The host owns durable, serializable run IDs; the SDK's invocation ID
is a process-local `symbol` and must not become a browser or database identifier.

| Forge capability to reuse | My-RAG responsibility |
| --- | --- |
| Model/tool loop and structured results | Register knowledge tools, validate evidence and produce the final cited product answer |
| Serial preparation and selectable tool scheduling | Preserve operation order for dependent writes; only parallelize independent reads |
| Tool hooks and permission interface | Apply authenticated actor/project context and operation grants; tools also enforce domain authorization |
| Context compaction and raw history records | Supply bounded evidence, preserve citations, configure context limits, keep summaries separate from knowledge sources |
| Incremental session persistence | Implement PostgreSQL storage, session ownership and write fencing |
| Abort, dispose and input receipts | Own browser disconnect policy, request deadlines, cross-invocation queues and job status |
| Model retry and usage events | Set cumulative request budgets and retry policy appropriate to 15/60-second targets |

Register retrieval, source contribution/update, Wiki correction/restoration and
job-status tools only. Do not install the CLI's filesystem or shell tools.
Tool schemas describe model-supplied arguments; organization, actor, operation
ID and trusted scope come from host context rather than trusting model fields.
Authorized unambiguous knowledge operations execute without routine permission
dialogs. Ambiguous target resolution follows Q18. Configure Forge's permission
policy deliberately so its default permission wait cannot consume the answer
budget or bypass My-RAG authorization.

Place the passages and citation handles the model needs in tool `content`.
Use `details` for UI/trace metadata, not as the only location of answer evidence.
Validate final citation handles against the host evidence registry and current
source versions before product delivery. A successful Forge turn is not itself
a quality-passing or current-evidence answer.

## Storage, concurrency and mutation recovery

Create one active SDK instance per executing conversation and enforce one writer
per conversation with a database lease/fencing token. Five concurrent requests
can belong to five independent instances; same-session requests queue at the
host. Persist message/compaction entries and selected-leaf changes atomically.
An acknowledged append must reload, and a duplicate acknowledged record ID must
not create a second record. Ambiguous database commit outcomes fault the instance
and require inspecting durable state before resuming.

My-RAG domain operations retain their own idempotency keys and durable statuses.
Forge saves assistant tool calls before effects, but session history cannot make
a document mutation and its tool-result append one atomic operation. On recovery,
reconcile known operation IDs; do not replay a call merely because its result is
missing from session history. The documented SDK also treats missing historical
results as unknown effects rather than replay permission. [S1, S5]

The server owns continuous event consumption. Browser subscribers observe that
stream; a disconnected browser must not accidentally stop consumption or imply
that durable work rolled back. Cancellation stops new work and waits for started
operations to settle; accepted background maintenance jobs retain their own
lifecycle. Report domain operation state separately from an aborted answer.

## Budget integration gaps and local adaptation

The current public options expose per-response `maxTokens`, context and retry
settings, and tool hooks. They do not expose a cumulative model-request quota or
a public before-every-model-request budget gate. Events are buffered for host
consumption, so counting observed events alone cannot strictly prevent the next
request. These are integration constraints, not demonstrated contract bugs.
[S3, S4]

Do not inherit the default three retries with 2/4/8-second waits into ordinary
RAG questions. Task retries, compaction requests and recovery can all spend the
same product deadline. Start with one retry and a short 250 ms base delay, only
when the remaining budget permits; record every actual model request. The final
host-selected values must pass the controlled budget cases before claiming the
blueprint's limits are enforced. [S1, S7]

Use a host-owned budget object for deadlines, retrieval rounds and token/call
accounting. Tool wrappers can enforce retrieval limits before effects. A minimal
local Forge patch may be needed to consult that object immediately before every
task, retry and summary request. Such a patch belongs at the pinned SDK/model
request seam and must include regression coverage; do not build another execution
loop. A model-request admission failure must preserve saved history and allow
the host to return existing evidence or an explicit budget result.

The subsequent construction alignment selects a distinct finalization phase:
M06 performs tools-disabled grounded generation followed by separate semantic
support review over original evidence, charged to M07's shared budget. At most two
generation and two review requests cover repair or one host-controlled source
refresh; citation and freshness checks still run before delivery.
The [shared contract C05](../design/rag-v1/contracts.md#c05-budgets-and-finalization)
owns this behavior. It is My-RAG integration design, not an existing Forge feature
or a separately implemented Agent loop. The actual wiring still needs validation.

`abort()` is cooperative. A tool ignoring its signal or a stalled storage write
can delay disposal; returning a timed-out response does not prove work has ended.
Give My-RAG tools bounded I/O and do not reuse a still-running instance. If a
strict process-kill requirement emerges, add process isolation deliberately; the
SDK does not provide it. [S1]

## Dependency and patch handling

Vendor the inspected `core`, `protocol` and `tools` workspace packages as a
pinned source snapshot under a clearly identified vendor directory during
implementation. Preserve Forge's MIT license, nested runtime license/provenance,
and required `pi-ai` patch. The inspected baseline uses
`@earendil-works/pi-ai@0.85.1`, `typebox@1.3.7`, and Bun `1.3.12`. Resolve and
validate the consuming workspace lockfile; do not assume copying `core` alone or
installing an npm package named `@forge-agent/core` reproduces this runtime.

Record upstream URL/SHA, imported package paths, license files, dependency
versions, and a separate local patch manifest. Keep My-RAG tools and PostgreSQL
storage outside vendor code. Local SDK fixes need focused reproductions and
upgrade/removal criteria. Pulling a future upstream fix requires checking the
pinned source and replaying the affected tests; never follow `master` silently.

When an upstream defect is reproduced, check for an existing issue, then report
the exact SHA, minimal reproduction, expected/actual behavior, impact and local
workaround to `L-1ngg/forge-agent`. Report a required new capability as an
enhancement, not as a broken existing promise. The user's authorization covers
these issue reports and local My-RAG fixes without another routine confirmation.
No defect was established in this inspection, so no upstream issue was created.

## Fresh validation and limits

Ran on the matching local checkout using Bun `1.3.12`:

```sh
bun test packages/core/test/sdk.test.ts packages/core/test/sdk-integration.test.ts packages/core/test/runtime-tools.test.ts packages/core/test/incremental-session.test.ts packages/core/test/input-ownership.test.ts packages/core/test/runtime-retry.test.ts
```

Result: **43 passed, 0 failed, 771 assertions across 6 files**. Coverage includes
the public SDK with loopback HTTP model responses and custom tools, multiple
instance isolation, permission handling, persistence-before-effects, storage
failure, cancellation, missing-result recovery, input ownership and task retry.

This is fresh upstream contract verification, not a My-RAG integration or
production benchmark. Not run: PostgreSQL storage adapter, copied workspace
installation, cumulative budget patch, real provider calls, My-RAG browser flows,
or the complete upstream suite. None has been implemented by this investigation.
The next implementation slice should first validate those integration seams
with a local scripted provider and source-evidence tool before expanding scope.

## Sources at the inspected revision

- S1: [Public SDK guide](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/docs/sdk.en.md).
- S2: [Core package manifest](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/packages/core/package.json).
- S3: [Public options and host facade](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/packages/core/src/agent.ts#L13).
- S4: [Session execution and model-request assembly](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/packages/core/src/agent-session.ts#L43).
- S5: [Session storage contract and recovery projection](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/packages/core/src/session-storage.ts#L26).
- S6: [Public SDK tool protocol documentation](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/docs/sdk.en.md#L150).
- S7: [Context and retry defaults](https://github.com/L-1ngg/forge-agent/blob/c5a4291def7f5346c428fe1c22d7b4d411742e23/packages/core/src/context/compaction.ts#L6).
