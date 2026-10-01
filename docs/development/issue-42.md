# Issue #42: MCP reading and independent credentials

Settings creates named 256-bit random MCP credentials and stores only SHA-256
verification state. One-time plaintext lives in transient component state, never
the Query/Form cache, later lists or SSR snapshots. Token revocation is independent
of Web access and other tokens. Each MCP request verifies current token state;
each read rechecks the verified token, including calls on an existing session.

One shared createMCPServer instance serves unmodified SDK Responses through raw
Start GET/POST/DELETE. It exposes the four shared TanStack reading definitions
and bounded immutable physical-page resources. The server checks token/document/
source/page relationships; explicit historical reads do not launch QA.

The installed MCP 0.6.0 resource callback accepts no URI/context. A small
AsyncLocalStorage bridge carries the verified request caller and URI from a cloned
request to that callback. It changes no MCP protocol/session/response encoding and
also isolates concurrent legacy-session callers from the package's mutable latest
request context. Source: create-server.ts registerServerResource and definitions.ts
resourceDefinition. There is no separate Hono entry or custom MCP protocol.

Ran: production build/typecheck and two Playwright/official-client tests with real
PostgreSQL. Legacy Streamable HTTP initialized a real session, listed exactly four
tools and invoked every primitive and immutable page resource. Auto-negotiated
modern calls also passed. Invalid page/actor/mutation calls failed. Primitive reads
made zero QA provider requests. Create/list/dismiss/reload/revoke UI retained no
plaintext; revoked existing sessions/resource requests denied while another token
and Web access worked. A compiled second process was SIGKILLed and restarted:
unrevoked credentials remained valid, revoked ones remained denied, and lists did
not reveal plaintext. MCP credentials could not access Web-only PDF routes.

Not run: third-party Agent application UI; official client 2.0.0 establishes actual
protocol behavior. #43 adds the independent fifth question_answer tool. No commit/
push made.
