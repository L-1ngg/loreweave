# Settings and MCP

Settings manages model connections, the `index` and `qa` defaults, and independent
MCP tokens. The local instance has one owner. Web login uses
`LOREWEAVE_ACCESS_PASSWORD` from the private [runtime configuration](../development/configuration.md).
Changing that password in the configuration and restarting resets access without
an email-recovery service.

## Model connections

Save an official OpenAI or OpenAI-compatible connection with its Base URL and API
key. A compatible URL should include the provider's API prefix, usually `/v1`.
Assign a saved connection and Model ID to each role:

- `index` constructs/refines document structure and navigation summaries.
- `qa` executes reading tools and answers questions.

Verify both roles. Verification exercises tool calls, streaming and structured
outputs against that specific connection/model; it makes real requests in `real`
mode. A provider's model name alone does not prove compatibility. Fixture mode
accepts only loopback providers and is intended for controlled development.

Credentials are encrypted and retained on the server. The browser receives
nonsecret metadata, not saved plaintext keys. Keep the instance wrapping key and
database together in a private backup. Editing a connection or role affects new
work; accepted indexing attempts and questions retain their captured revision.

## Connect an MCP client

Create a named token in Settings and copy its secret when displayed. The plaintext
is shown once. Configure your client's **Streamable HTTP** connection as:

```text
URL: http://127.0.0.1:41737/mcp
Authorization: Bearer <token>
```

Use the URL printed by your local service if it selected another port. Revoking
one token disables that credential independently; other tokens and Web login
continue to work. Tokens permit document reading and independent questions, with
no library or settings administration.

## Reading tools and questions

| Tool                     | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `browse_documents`       | Discover current document metadata and readiness            |
| `get_document`           | Inspect a document and its source/index identities          |
| `get_document_structure` | Read bounded tree titles, summaries and page ranges         |
| `get_page_content`       | Read persisted physical-page originals                      |
| `question_answer`        | Run one independent server-side question with page evidence |

Discover schemas through the client's `tools/list`; outputs include continuation
information where bounded results are incomplete. Immutable page resources use
`loreweave://sources/<versionId>/pages/<page>`. Resource reads and historical
inspection still require a valid, currently authorized token.

The first four tools let an external agent manage its own reading. They do not
start LoreWeave QA. `question_answer` uses the saved `qa` role, has no Web
conversation prerequisite and carries no history between invocations. It can
incur model charges. Internally, LoreWeave calls the shared reading services
directly; its reading agent does not call its own MCP endpoint or recursively use
`question_answer`.
