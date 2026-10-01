# PageIndex v1 Shared and Module Contracts

Status: implemented application contracts, 2026-10-01. Callable entry points
are mapped by the [module map](README.md). #30-#46 record per-slice checks;
#47 owns the final measured acceptance and remaining verification limits.
[Spec #29](https://github.com/L-1ngg/loreweave/issues/29) controls product scope.

## Common identities and invariants

| Identity           | Meaning                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Owner              | The sole instance owner, established by trusted authentication                           |
| Document           | Stable library item independent of filename or uploaded bytes                            |
| Source version     | Immutable original PDF and its extracted physical pages                                  |
| Index revision     | One validated tree/artifact set for a source version and captured indexing configuration |
| Tree node          | Opaque identity meaningful only within its index revision                                |
| Indexing operation | Accepted upload/update identity, stable across observation/retry                         |
| Indexing attempt   | One bounded execution, including mode/configuration and compatible stage manifests       |
| Conversation       | Owner-held history and persisted library/selected-document scope                         |
| Knowledge run      | One bounded Web turn or independent MCP question                                         |
| Source reference   | One run's validated binding to a source version and physical page                        |

Physical pages are integers from 1 through the PDF's page count. Printed labels
are separate display metadata. Tree ranges are inclusive and may share a valid
boundary page. Every physical page, including front matter, remains reachable.

Trust actor/capability context supplied by M01. A client argument cannot supply
ownership, expand scope or turn an MCP token into a Web management credential.
Validate document/source/index relationships as well as the individual IDs.
Authorization applies to historical reads, hydration, replay and cached content.

New QA reads require current document eligibility; authorized historical source
inspection is a distinct read purpose. Retired bytes can resolve history without
reentering discovery or a new follow-up. Stale selected scope is an explicit
failure, never an implicit switch to library mode.

## M01: Access and model configuration

Interface: owner login/logout/session inspection; authenticate named MCP token;
authorize a capability; manage connection/default-role settings; capture the
configuration of an index or QA role. Implementation hides session storage,
token verification and credential sealing.

| Context                               | Capabilities                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Authenticated Web owner               | Document and conversation management, model settings, token administration and reads |
| Verified MCP credential               | Published document/resources and independent question_answer only                    |
| Unauthenticated or revoked credential | No library, history, originals, settings or QA access                                |

The Web access password comes from runtime configuration and is reset through
that configuration. Named MCP secrets are cryptographically unpredictable,
displayed only at creation and stored as verification state with name/status.
Revoking one credential does not alter other tokens or Web authentication.

The two model roles select a connection revision and Model ID. Connections
support official OpenAI or a verified compatible Base URL through the maintained
adapter. Persist saved credentials in sealed server storage, with the wrapping
key supplied through runtime configuration; lists/details/history return only
nonsecret metadata and a configured-secret indicator. Secrets never become
browser adapter parameters or logged run provenance.

Capture an immutable connection/configuration revision when an attempt/run is
created. Editing a connection or role creates new configuration for new work;
captured work continues with the old revision. Missing/unsupported settings
produce explicit errors. The system does not switch provider or indexing mode
to make an incompatible request appear successful.

Acceptance surface: owner login/settings through public HTTP and browser,
credential verification through an official MCP client, current access after
revocation/restart, and model dispatch through controlled endpoint profiles.

## M02: Document library

Interface: accept ordinary upload or targeted update; inspect/paginate metadata;
resolve an immutable original/page/index; atomically activate a prepared result;
retire a document. M02 hides byte storage and its relational representation.

Own documents, source versions, pages, index revisions/nodes and the effective
source/index pointer. A document has an independent library revision and a
retirement marker. New uploads create new document IDs even for matching names.
An update supplies the explicit document ID and expected prior library revision.

An accepted operation key is owner-scoped and fingerprints action, target, bytes
and relevant input. Repeating that same operation returns its existing identity.
Changing its payload under the same key fails; a new deliberate upload uses a
new key. Original-file durability and metadata commit precede acknowledgment.

Publish source/index artifacts in one database transaction after validation.
Check expected prior revision, current retirement state and matching operation/
attempt/version identity. A failed compare-and-set cannot overwrite a later
version or reactivate a retired document. Until publication, or after failure,
the previous effective source remains readable.

Keep original bytes, historical page/index records and issued references on
retirement. Browse/new QA excludes retired documents; historical resolution
checks current authorization. Conversation removal never cascades into document
or original-file removal. Permanent source purging is outside this delivery.

Acceptance surface: accepted upload/status/read through HTTP, update/retirement
through Web, and old/new citations or immutable resources through Web/MCP.

## M03: PDF indexing

Interface: inspect an accepted operation; execute one captured attempt; retry a
failed/interrupted attempt with explicit mode; return a validated publication
candidate to M02. See [indexing design](indexing.md) for the internal stages.

Own operation/attempt progress and manifests; M02 owns the durable source and
published artifacts. Use a small bounded background worker within the single
application process. Browser lifetime is not an indexing cancellation signal.

Operation outcomes include queued, processing, ready, failed, unsupported and
interrupted. Persist stage and reason separately from an existing document's
effective version. An unsuccessful new preparation does not hide that version.

Attempts use their captured mode/model/budgets. A retry retains the accepted
document/version/operation, creates a new attempt and captures current settings.
Reuse only validated stage artifacts compatible with source, extractor revision
and relevant mode/model configuration. Mode-dependent tree/summary artifacts are
regenerated when switching Flash to Standard. There is no automatic fallback.

After process restart, unfinished attempts from the prior process are marked
interrupted and require manual retry, including accepted work not yet executed.
Never infer provider success from a local timeout or silently replay unknown
requests. Finite budgets count attempts and failed/retried work.

Acceptance surface: upload, progress, leave/reopen, crash/retry and artifact
inspection through the composed document interface with real PostgreSQL.

## M04: Shared document reading

Define the four tools once using TanStack server-tool definitions. Their
implementations accept trusted context plus bounded validated inputs. Web QA
uses them in-process; MCP uses the same definitions and reading implementation.

| Tool                   | Input meaning                                                | Observable output                                                   |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| browse_documents       | Cursor/limit and optional metadata filter                    | Authorized current metadata, usable status and continuation cursor  |
| get_document           | Document identity and optional authorized immutable version  | Document status, source/index identities, page count and provenance |
| get_document_structure | Document/version/index binding and cursor/limit              | Bounded title/summary/range hierarchy with continuation metadata    |
| get_page_content       | Document/version binding and bounded physical page selection | Stored original page content, labels and immutable reference data   |

Use common input/output schemas and ordinary stable cursor pagination. Limits
cap tree/page output, not only the number of requested pages. Truncation or
unavailable data is visible and cannot be interpreted as an exhaustive read.

Within a Knowledge run, enforce its library/selected scope, pinned source
version and remaining budgets on every primitive. Omitted selection is library
mode; a supplied nonempty list is an allowlist; an empty list is invalid. In
library mode, discovered candidates do not mutate the conversation's future
scope. Pin each candidate's version on its first substantive document read;
an explicit selection pins its validated versions at run acceptance.

Standalone MCP reads do not acquire a Web conversation or launch QA. Authorized
immutable/historical inspection is permitted with explicit version/reference
binding. It does not grant eligibility for a subsequent question_answer run.

Return enough read identity for M05 to durably record page access. M04 does not
write another module's run tables or require a conversation for direct reading.
Cache reuse checks current capability/scope/version and produces a new run read
record. The original PDF is not parsed again for a normal page-read tool call.

Acceptance surface: shared HTTP reads, in-process QA tool calls and official
MCP reads across current/historical, bounded, missing and unauthorized cases.

## M05: Knowledge runs and conversations

Interface: accept a Web question or independent MCP question; inspect/hydrate
its saved state; attach output; request Stop; create/rename/delete/read a Web
conversation. See [QA and streaming design](qa-and-streams.md).

Own canonical conversation history, run state/configuration/scope, version
bindings, page-read records, citation handles and delivery identity. Use the
maintained TanStack loop; document facts require original pages, not tree
summaries, prior assistant assertions or general model knowledge.

Acceptance commits the user message, question/run identity and captured scope/
configuration before starting model work. A retry of that accepted submission
does not append another message or reset budgets. A deliberate manual resend
after failure/interruption has a new submission/run ID and retains the old record.

One active writer owns a conversation. Coordinate new-turn acceptance and
conversation deletion in a database transaction. Reject deletion while accepted
QA is queued/running/stopping; explicit Stop and a terminal outcome come first.
New turns cannot race deletion into a deleted conversation. The first version
does not add message edits, branching or completed-answer regeneration.

Use the TanStack MessageStore/RunStore surface with a small PostgreSQL adapter.
Keep product outcome reasons distinguishable even if SDK lifecycle enums differ.
Web run terminal outcomes are completed, failed, stopped and interrupted.
The replay log is delivery state; the persisted transcript/run is authoritative.

Citations bind run, document, source version and one physical page actually
recorded as read. Validation checks access, run scope, relationships, bounds and
availability. A citation label cannot fabricate evidence or authorize a source.
Do not describe location validation as semantic support certification.

Independent MCP QA uses the same reading/evidence rules and captured QA role.
It has no Web conversation prerequisite or cross-invocation chat history. Save
its run/source-reference records for authorized resolution; do not manufacture
Web history or register question_answer inside the reading Agent's own tools.

Acceptance surface: controlled-provider public QA, actual PostgreSQL history,
browser attachment/Stop and independent official MCP-client questions.

## M06: Web and MCP interfaces

Interface: validate/translate HTTP and MCP inputs, render the three working
views, hydrate/attach saved runs and display the immutable original. Domain
state, authorization and model work stay behind M01-M05.

Use TanStack Start/React with Router, Query, Form and AI React as described in
[Web/runtime integration](frontend-and-runtime.md). Ordinary internal Web
commands/queries use typed server functions; uploads, authorized PDF GET/HEAD/Range,
SDK SSE and MCP use raw server routes. The composition root shares the MCP server
instance and delegates its Request/Response transport after token verification.

Query owns authorized metadata/status caches and hydration, with a QueryClient
per SSR request. AI React owns streamed-message presentation; canonical transcript
and run state remain in M05. A hydration snapshot cannot become another writable
history in Query/DB. Clear private presentation/cache state on session loss and
reconcile stable IDs on attachment. Form input validation complements server
validation; model secrets and one-time tokens do not enter persistent caches.

Use server-derived context, not request actor IDs. Render generated Markdown
safely with raw executable HTML disabled. Validate citation handles before
making them navigable. Serve authorized PDF bytes, including range requests
needed by the viewer. Printed page labels do not change the physical target.

The target HTTP surface below describes logical commands/queries, not an old-API
compatibility commitment. Ordinary Web-only operations may use equivalent Start
server functions instead of duplicate REST handlers. Raw upload/original/events/
MCP interfaces remain explicit HTTP routes. Related variants may be combined
without changing the module contracts; checks exercise the chosen public boundary.

| Surface              | Commands/queries                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Owner access         | POST /api/auth/login, POST /api/auth/logout, GET /api/session                                               |
| Model settings       | GET/POST /api/model-connections, PATCH /api/model-connections/:id, GET/PUT /api/model-roles                 |
| MCP credentials      | GET/POST /api/mcp-tokens, DELETE /api/mcp-tokens/:id                                                        |
| Library              | GET/POST /api/documents, GET /api/documents/:id, POST /api/documents/:id/updates, DELETE /api/documents/:id |
| Index progress/retry | GET /api/index-operations/:id, POST /api/index-operations/:id/retry                                         |
| Immutable inspection | GET /api/document-versions/:id/original, /pages and /structure                                              |
| Conversations        | GET/POST /api/conversations, GET/PATCH/DELETE /api/conversations/:id                                        |
| QA acceptance        | POST /api/conversations/:id/questions returns committed question/run IDs                                    |
| QA state/delivery    | GET /api/runs/:id, GET /api/runs/:id/events, POST /api/runs/:id/stop                                        |
| MCP transport        | SDK-supported GET/POST/DELETE /mcp with verified token context                                              |

Browser IDs and delivery cursors are opaque. Attach/hydrate requests are reads
of existing work. Client transcript contents cannot overwrite canonical history.
Public errors distinguish invalid scope, unsupported/not-ready documents,
evidence gaps, incomplete search, configuration failure and interrupted work
after access checks; failed work is never rendered as a validated ready result.

Keep desktop adjacent-original and mobile separate-original/return behavior.
Returning from source inspection restores message/scroll context and the same
run. Navigating between views changes subscription, not execution ownership.

Acceptance surface: desktop/mobile Playwright plus public HTTP and a real MCP
client; server-only tests do not establish usable viewer/navigation behavior.
