# Application contracts

These are the current interfaces and invariants behind the [module overview](overview.md).
Runtime schemas are in [src/contracts](../../src/contracts/); domain meanings
are in [CONTEXT](../../CONTEXT.md). Product changes are tracked in
[GitHub Issues](https://github.com/L-1ngg/loreweave/issues).

## Common identities

| Identity         | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Owner            | Sole instance owner established by trusted authentication                |
| Document         | Stable library item independent of filename or bytes                     |
| Source version   | Immutable PDF original and extracted physical pages                      |
| Index revision   | Validated tree/artifacts for a source version and captured configuration |
| Tree node        | Opaque identity local to an index revision                               |
| Index operation  | Accepted upload/update identity, retained across observation and retry   |
| Index attempt    | One bounded execution with captured mode/model and stage manifests       |
| Conversation     | Owner-held history and library/selected scope                            |
| Knowledge run    | One bounded Web turn or independent MCP question                         |
| Source reference | A run's verified binding to a source version and physical page           |

Physical pages are one-based positions, separate from printed page labels.
Inclusive tree ranges can share a valid boundary page; every original page remains
reachable. Validate ownership, document/version/index relationships and bounds,
including historical, cached, hydration and replay reads. A client ID cannot
create authority or broaden scope.

## M01: Access and model configuration

The authenticated Web owner can manage documents, conversations, model settings
and tokens. A verified MCP token can read published documents/resources and invoke
independent QA. Anonymous and revoked credentials have neither capability. MCP
credentials never become Web management credentials.

Web password reset uses private runtime configuration. Named MCP secrets are
unpredictable, shown once and stored as verification state; revocation is
independent of other tokens and Web sessions. Saved model credentials are sealed
server-side. Lists, histories and hydration expose nonsecret metadata, excluding
saved plaintext keys and internal storage paths.

The `index` and `qa` roles each select a connection revision and Model ID. Accepted
work captures that revision and its finite budgets. Edits apply to future work.
Missing/incompatible settings fail explicitly; the application does not switch
provider or mode automatically. See [configuration](../development/configuration.md)
and [settings](../guides/settings-and-mcp.md).

## M02: Document library

Ordinary uploads create independent documents even with the same filename. An
update targets an explicit document and expected library revision. Submission
identity is owner-scoped and fingerprints action, target, bytes and relevant
inputs. Repeated identical acceptance returns the existing identity; a changed
payload under the same key fails. Original-file durability and metadata commit
precede acknowledgment.

Activation checks validated artifacts, matching operation/attempt/version,
expected library revision and retirement state in one transaction. An older
completion cannot overwrite a later activation or resurrect a retired document.
Until activation, failed preparation leaves the prior effective source readable.

Retirement removes current discovery/new-question eligibility and retains
authorized original, page, index and reference history. Conversation deletion
does not cascade into document/original deletion. Permanent purging is outside
the current scope.

## M03: PDF indexing

Accepted operations expose `queued`, `processing`, `ready`, `failed`, `unsupported`
and `interrupted`, with separate stage and reason. The bounded local worker owns
execution; browser lifetime does not cancel it. Ready requires all mandatory
construction, refinement, summary and validation/publication stages.

Explicit retry of eligible failed/interrupted work retains document/version/
operation identity and captures a new attempt under current settings. Identical
retry submissions return the same attempt. The current implementation reuses only
validated extraction with matching source, extractor and digest; construction,
refinement and summaries are rebuilt. Switching mode never reuses the other
mode's tree. Startup interrupts unfinished prior attempts without model replay.
See [indexing](indexing.md).

## M04: Shared reading

The four server-tool definitions in [reading.ts](../../src/server/reading.ts)
serve Web QA and external MCP.

| Primitive                | Output                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `browse_documents`       | Authorized current metadata/readiness and continuation           |
| `get_document`           | Document/source/index identities, page count and provenance      |
| `get_document_structure` | Bounded title/summary/range hierarchy and continuation           |
| `get_page_content`       | Persisted original-page text, labels and read/reference identity |

Every run read enforces capability, scope, pinned version and remaining bounds.
Omitted selection permits library discovery; a nonempty selection is an allowlist;
an explicit empty list is invalid. Selected versions bind at acceptance. Library
candidates bind on first substantive read; discovery does not redefine future
conversation scope. New runs resolve current eligibility again.

New QA and authorized historical inspection are distinct read purposes. Retired
sources can resolve past citations without reentering new-question scope. Cache
reuse still requires current checks and creates a read record for the new run.
Normal page reads use stored artifacts instead of reparsing PDFs. Bounded/truncated
output is visible and cannot prove exhaustive search.

## M05: Runs, references and conversations

Acceptance commits user message, run identity, scope and captured configuration
before acknowledgment/model dispatch. Retrying the accepted submission creates
neither another user message nor another producer. A deliberate resend after
failure/interruption is new work retaining the old outcome.

One writer owns a conversation. Acceptance and deletion coordinate transactionally;
deletion while `queued`, `running` or `stopping` is rejected. Stop and a terminal
outcome come first. Message edits, branches and completed-answer regeneration
are outside the current scope.

PostgreSQL is authoritative through the TanStack MessageStore/RunStore adapter.
Delivery logs are transient. Completed, failed, stopped and interrupted outcomes
remain distinct. Browser detachment observes no new run and does not cancel the
producer; restart serves committed history without execution replay.

Facts require originals actually read in this run, rather than summary text,
prior assistant claims or general model knowledge. References validate run,
document, immutable version, physical page, authorization and recorded access.
Location validity does not certify semantic claim support. Independent MCP QA
has its own run and references, no Web conversation or cross-invocation transcript,
and never exposes `question_answer` to the internal reading agent. See
[runs and evidence](runs-and-evidence.md).

## M06: Web and MCP boundaries

Ordinary Web commands/queries are typed Start server functions in
[src/functions](../../src/functions/), including `loginOwner`, `getLibrary`,
`retryOperation`, `askQuestion`, `stopQuestion`, `getConversation` and settings/token
commands. Their framework-generated HTTP URLs are not a separate REST contract.

Raw Start routes retain native HTTP behavior:

| Method and route                               | Responsibility                                  |
| ---------------------------------------------- | ----------------------------------------------- |
| `POST /api/documents`                          | Multipart ordinary upload                       |
| `POST /api/documents/:id/updates`              | Multipart targeted source update                |
| `GET/HEAD /api/document-versions/:id/original` | Authorized immutable PDF bytes, including Range |
| `GET /api/runs/:id/events`                     | Authorized SDK SSE attachment/replay            |
| `GET/POST/DELETE /mcp`                         | Maintained Streamable HTTP transport            |

Server-derived context controls both surfaces. Query caches authorized metadata;
AI React presents messages; Form validation complements server validation.
Logout clears private cache/presentation state. Hydrated transcripts are input
snapshots, not another writable history. Render generated Markdown with executable
HTML disabled and validate references before making them navigable.

Desktop shows adjacent originals; mobile inspection returns to the originating
conversation position and run. Navigating changes observation, not execution.
See [Web/runtime](web-and-runtime.md) and [public-boundary testing](../development/testing.md).
