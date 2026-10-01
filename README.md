# LoreWeave

LoreWeave answers questions from local PDF originals with inspectable physical-page
citations. It builds document trees with Flash or Standard indexing, uses those
trees to find relevant pages, and grounds answers in pages read during the question.

The Web workspace provides a document library, saved conversations and settings.
External agents can use the same reading services through MCP. This version is for
a single owner running the source locally with Bun, TypeScript and PostgreSQL.
Application deployment packaging is outside its current scope.

## Start locally

Use Bun 1.3.12 and PostgreSQL 17. The supplied Compose service provisions the local
database; it does not deploy the application.

```sh
bun install --frozen-lockfile
bun run setup
docker compose up -d --wait postgres
```

Setup preserves an existing `.pageindex.env`, or creates a private file containing
the access password, database connection and credential wrapping key. Its initial
mode is `fixture`, intended for controlled development. For normal document use,
set `LOREWEAVE_MODE=real` in that file, then start:

```sh
bun run dev
```

Open the printed URL (normally `http://127.0.0.1:41737/`) and log in with
`LOREWEAVE_ACCESS_PASSWORD` from your private configuration. An occupied port is
preserved and the next available port is printed. In Settings, save an OpenAI or
compatible connection, assign both `index` and `qa` roles, and verify each role.
See [settings and MCP](docs/guides/settings-and-mcp.md) for the connection workflow.

For compiled local serving:

```sh
bun run build
bun run start
```

## Use the workspace

- [Documents](docs/guides/documents.md): import text-layer PDFs, choose Flash or
  Standard, inspect originals, retry, update and remove documents from the library.
- [Conversations](docs/guides/conversations.md): select a scope, ask follow-ups,
  inspect citations, reconnect to accepted work and explicitly Stop a run.
- [Settings and MCP](docs/guides/settings-and-mcp.md): configure models and create
  independently revocable tokens for external clients.

Accepted indexing and questions continue after closing or navigating away from
the browser. Restarting the application marks unfinished work interrupted and
requires deliberate retry or resend. Source updates and library removal preserve
authorized historical originals and citations.

## Develop and evaluate

[The documentation index](docs/README.md) links current architecture, configuration
and development guidance. Start contributing with [CONTRIBUTING](CONTRIBUTING.md).
The [version evaluation](docs/evaluation/pageindex-v1.md) separates controlled
protocol checks from real-provider measurements and their limits. Frozen evidence
can be verified and recomputed without model calls; routine runs write to ignored
directories rather than changing documentation or approved baselines.

Source attribution is in [NOTICE](NOTICE.md); earlier implementations and recovery
information are linked from [history](docs/history.md).
