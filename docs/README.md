# Documentation

These documents describe the current LoreWeave application and how to use,
maintain and evaluate it. [README](../README.md) provides local startup;
[CONTRIBUTING](../CONTRIBUTING.md) defines the development and documentation workflow.

## Using LoreWeave

- [Documents](guides/documents.md): supported inputs, indexing modes, originals,
  retries, updates and removal from the library.
- [Conversations](guides/conversations.md): discovery and selection, evidence,
  follow-ups, reconnect, Stop and history management.
- [Settings and MCP](guides/settings-and-mcp.md): login, model roles, token
  management, transport and the external reading tools.
- [Configuration](development/configuration.md): runtime environment, private
  storage, work bounds and development output locations.

## Understanding the implementation

- [Architecture overview](architecture/overview.md): modules, dependencies,
  entry points and data ownership.
- [Contracts](architecture/contracts.md): access, identities, publication,
  scope, reading and history invariants.
- [PDF indexing](architecture/indexing.md): extraction, Flash, Standard,
  summaries and attempts.
- [Runs and evidence](architecture/runs-and-evidence.md): acceptance, original
  reading, citations, streaming, Stop and interruption.
- [Web and runtime](architecture/web-and-runtime.md): framework responsibilities,
  server functions, raw routes and cache ownership.
- [Domain glossary](../CONTEXT.md): canonical terms and meanings.
- [Architectural decisions](adr/README.md): accepted choices and superseded decisions.

## Verification and history

- [Testing](development/testing.md): offline checks, PostgreSQL conformance,
  public transports and desktop/mobile browser tests.
- [Evaluation method](development/evaluation.md): frozen inputs, isolated
  comparison, real-provider runs and external evidence storage.
- [PageIndex v1 results](evaluation/pageindex-v1.md): dated measurements and support
  review, including failed trials and unverified boundaries.
- [History and recovery](history.md): prior implementations and fixed revisions.
- [Source attribution](../NOTICE.md): pinned sources and retained licenses.

Product scope and work status live in [GitHub Issues](https://github.com/L-1ngg/loreweave/issues).
Ticket drafts and per-task execution journals are not published as project documents.
