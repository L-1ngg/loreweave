# M09: Product interfaces

M09 presents knowledge operations consistently through browser, HTTP and MCP.
It translates requests and outcomes; domain decisions stay in the other modules.

## Interface

- Browser conversation with uploads, progress, cancellation and reconnection.
- Shared/project Wiki navigation, versioned page/source reading and citation links.
- HTTP commands/queries and run-event streaming for that browser.
- Organization-scoped MCP evidence search and cited question answering for
  external Agents; expose only explicitly granted supported operations.

## Ownership and dependencies

Own transport schemas, public error mapping, UI navigation and view state.
Use M01 authentication, M07 turns, M02 source reads, M05 page reads and M08 status.
Use M06 directly for read-only evidence tools where full conversation is not
needed. Keep model and database access out of route handlers and browser code.

## Invariants and failure behavior

No internal document IDs are required in normal user flows. Natural-language
intent plus selected project/document determines operations; only ambiguous
targets prompt clarification. Reconnection uses durable run/event IDs and
never submits a second mutation just to recover the view.

Render Markdown safely with executable raw HTML disabled and image text/link
fallback. Expose processing, searchable, pending update, conflict and failed
refresh states; a successfully uploaded file is not automatically ready Wiki.
Distinguish operation success from answer timeout. Allow historical source/page
navigation without representing those versions as current evidence.

## Acceptance boundary

Drive the user flow in a browser and repeat the same evidence request over MCP.
Verify equivalent scope/citations, native upload/update intent, ambiguity handling,
read-only grants, reconnect without duplicate effects, historical citations and
safe Markdown rendering. Do not treat a headless SDK pass as browser acceptance.
