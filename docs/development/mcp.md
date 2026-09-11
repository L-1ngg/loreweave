# Organization-scoped MCP

The local scripted application serves Streamable HTTP at
`http://127.0.0.1:41736/mcp`. The pinned official TypeScript SDK is
`@modelcontextprotocol/sdk@1.30.0`; its Web Standards transport runs directly in
Bun/Hono. Each POST uses a fresh stateless MCP server and a JSON response. No MCP
session or browser conversation is selected implicitly. The endpoint is bound to
the same loopback deployment boundary as the application; remote deployment and
OAuth discovery are outside this local bootstrap.

## Credentials

An administrator authenticated through the existing browser login API calls:

```http
POST /api/admin/credentials
Content-Type: application/json
Cookie: loreweave_session=<administrator login token>

{"name":"my-agent","grants":["read"]}
```

The response returns `id`, a one-time `token`, `name`, `grants` and `expiresAt`.
Store the token and ID in the client's secret configuration. The server stores
only its SHA256 hash. Credentials expire after 30 days, belong to the issuing
administrator's organization/member and cannot exceed the member's current
permissions. Only the read grant is supported in this release. Browser login
tokens are rejected at MCP; the external bearer cannot import, correct, restore
or administer through domain commands or browser APIs.

Send `Authorization: Bearer <token>` on every MCP request. The server rechecks
expiration, revocation, member enablement and grants on each request and domain
operation. To revoke the key, an organization administrator calls
`POST /api/admin/credentials/<id>/revoke`. Login-session revocation and external
key revocation are separate operations. A key does not survive member disablement.

## Tools and citations

Both tools accept `{ "question": "...", "projectId": "optional UUID",
"complex": false }`. Unknown fields are rejected; clients cannot inject an actor,
organization or browser conversation ID. A project is checked against the
credential's organization. It includes shared material. Omitting the project
performs the same organization-wide query as the existing browser/source service;
this is a relevance choice, not a member visibility permission.

- `evidence_search` returns `schemaVersion: 1`, `requestId`, trusted `scope`,
  `items`, `gaps`, `checkedAt` and retrieval diagnostics. Each item carries exact
  source version/passage/text, source state, applicability and an immutable
  `citation` URI. Stale items found while checking the pack are excluded and
  `source_changed` is reported. A derived-route gap is not proof that facts are absent.
- `question_answer` returns `schemaVersion: 1`, `run`, `scope`, `citations` and
  `gaps`. Each request starts an independent M07 run and uses M06 generation,
  separate support review and final source checks. `run.status` distinguishes
  answered, partial, failed and timeout; a returned response alone is not a
  successful answer. Citations preserve `validatedAt` and original applicability.
- `resources/read` resolves `loreweave://source/<version>#<passage>` into JSON
  containing the immutable original, heading, applicability, source state and
  current version. Old handles stay readable after updates and explicitly report
  `superseded`; they do not become current evidence again.

Question answering inherits the 30/60-second Host limits and admission/settlement
policy. A durable user result can return while SDK/storage cleanup is still
settling; the Host keeps its execution slot until that cleanup finishes. Deadline
expiration ends response waiting and reports `budget_exhausted`. Credential
admission is also bounded by 30 seconds from request receipt, consuming the same
absolute request budget. Evidence search has a matching 30/60-second cancellation signal and at
most five active searches per application instance. Disconnect cancels that MCP
request's work; it cannot mutate knowledge. Tool errors have `isError: true` and a
safe reason. Unauthorized HTTP admission returns 401; unsupported HTTP methods
return 405. JSON-RPC transport details follow the pinned SDK.

## Validation boundary

`bun run test:mcp` runs a real official MCP client over loopback HTTP against real
disposable PostgreSQL and controlled providers. It checks browser/MCP scope and
citation parity, source-update validity, historical resource reads, independent
conversations, cross-organization isolation, rejected mutation/forged context and
revocation on an already connected client. Credential issuance/revocation is also
exercised through authenticated HTTP. Delayed writer cleanup proves successful
and timed-out responses do not wait for settlement; a closed source database
proves resource errors do not expose internal storage messages. A stalled
credential lookup exercises the real 30-second admission cutoff. These are behavior tests; real-model answer
quality, external network hosting and capacity are not certified by these fixtures.
