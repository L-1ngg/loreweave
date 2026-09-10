# LoreWeave

An agent-powered knowledge base with a living wiki, graph-assisted retrieval,
and source-backed answers.

**Current capability: authenticated Markdown knowledge conversations and document updates (#2–#7).**
Members import versioned originals, ask questions through Forge, and open exact
passages behind answer citations. PostgreSQL lexical/vector retrieval uses RRF;
the answer pipeline validates claim spans and citations, performs a separate
original-support review, and rechecks source versions before delivery. Cancellation,
reconnect, source activation and operation receipts persist in PostgreSQL.

The local runtime uses deterministic embedding and extractive generation/review
fixtures. It verifies the execution and validation contracts; it does not measure
semantic model quality, independent factual truth or production capacity. Wiki
and graph workers remain later delivery slices.

## Run locally

Use Bun 1.3.12 and Node.js 24 (Vite runs through its Node CLI):

```sh
bun install --frozen-lockfile
docker compose up -d --wait postgres
export DATABASE_URL=postgres://loreweave:loreweave_local@127.0.0.1:45432/loreweave
export LOREWEAVE_ORGANIZATION=local
export LOREWEAVE_BOOTSTRAP_USERNAME=admin
# Enter a password of at least 12 characters, then press Enter (Bash/zsh).
read -r -s LOREWEAVE_BOOTSTRAP_PASSWORD
export LOREWEAVE_BOOTSTRAP_PASSWORD
bun run bootstrap:admin
unset LOREWEAVE_BOOTSTRAP_PASSWORD
bun run dev
```

Open <http://127.0.0.1:41735>. The API binds to `127.0.0.1:41736` and the scripted
model server uses a dynamically assigned loopback port. No provider credentials are required. The database is a dedicated local instance;
startup applies the reviewed Drizzle SQL migrations. If either fixed port is occupied, stop this
new process and resolve the conflict explicitly; it never replaces another service.
The dev command disables automatic `.env` loading for its backend.

Log in with organization `local`, username `admin` and the password you chose.
Use “成员与项目管理” to create members, revoke their existing logins and create
project classifications. A selected project also searches applicable shared material;
projects do not create member visibility ACLs. Import a document, ask about its contents and follow a citation. The development
model quotes matching originals with attribution; it is not a general answering model. Runs and Forge history persist across process restarts. Imports preserve original UTF-8 bytes, versioned passages and Chinese/technical lexical fields.
Choose a Markdown file (up to 1 MiB), then use “直接导入” or ask “请把附件导入知识库”.
Source preparation survives browser and process restarts; the source becomes searchable
only after all vectors and lexical records are committed. The current embedding adapter
is a deterministic integration fixture, not a semantic model. Wiki, identity and graph
maintenance events are durably queued; their workers arrive in later slices. The question-answer
fixture now retrieves those imported originals. The conversation URL restores progress without submitting another turn. This entry point remains a local scripted development service.

Open a current source and use “更新此文档” → “提交新版本” to replace that
selected document. Preparation keeps the prior source effective; historical links
remain readable after activation. During generation/review, a serial 100 ms source
check cancels obsolete provider I/O and waits for it to settle. The host may refresh
once using an unused original retrieval round and the remaining generation/review
slots; it never restarts Forge or resets the deadline. If changes continue or slots
are exhausted, only independently reviewed, still-current claims with complete
premises can survive as a partial answer; otherwise the run reports a source-change gap.
Source freshness is checked at final admission, not promised indefinitely after delivery.

## Checks

```sh
bun run typecheck
bun run format:check
bun run check:docs
bun run check:vendor
bun run test
bun run test:upstream
# Use a separate disposable PostgreSQL database for the following tests.
docker run --rm -d --name loreweave-test -p 127.0.0.1:45433:5432 \
  -e POSTGRES_USER=loreweave -e POSTGRES_PASSWORD=loreweave_test \
  -e POSTGRES_DB=loreweave_test pgvector/pgvector:0.8.2-pg17
# Wait until: docker exec loreweave-test pg_isready -U loreweave
export TEST_DATABASE_URL=postgres://loreweave:loreweave_test@127.0.0.1:45433/loreweave_test
bun run test:persistence
bun run test:access
bun run test:sources
bun run test:evidence
bun run test:updates
bun x playwright install chromium
bun run test:browser
bun run build
docker stop loreweave-test
```

Host/HTTP tests use real loopback provider requests and observable outcomes.
Browser and persistence tests require `TEST_DATABASE_URL` and exercise real
PostgreSQL; the browser server uses this test URL, never silently the development
database. CI provisions its own disposable database. The persistence suite injects
storage errors and terminates a conversation database session, so use an isolated
test database. Real-provider answer quality and capacity acceptance remain later work. `build` emits the browser bundle; `dev` is the current local
runtime, not a production deployment command.

## Interrupted execution

A lost browser connection leaves execution on the server. A lost database writer
faults execution; acquiring its lock does not prove external work has terminated.
Inspection reports interrupted generation without restarting it, preserving the
original deadline, budgets and draft identity. No same-conversation writer may
pass an unsettled predecessor.

After an operator has confirmed the old process and started tool I/O have ended:

```sh
bun run reconcile:run RUN_ID --execution-terminated
```

Without the flag, the command records interruption but does not settle execution.
It cannot take a lock away from a live writer. This command never replays tools or
repairs missing historical tool results; those require domain-operation reconciliation
before the conversation can execute again. [Persistence details](docs/development/conversations.md)
record the current boundary and deployment limits.

## Construction and provenance

- [Specification and live tasks](https://github.com/L-1ngg/loreweave/issues/1)
- [Blueprint](docs/rag-v1-blueprint.md) and [nine-module contracts](docs/design/rag-v1/README.md)
- [Task dependency map](.scratch/rag-v1/README.md)
- [Confirmed decisions](docs/rag-optimization-design.md) and [domain terms](CONTEXT.md)
- [Evaluation plan](docs/rag-evaluation-plan.md)
- [Evidence retrieval and answer admission](docs/development/evidence.md)
- [Markdown source behavior](docs/development/sources.md)
- [Access and credential behavior](docs/development/access.md)
- [Pinned Forge source and local patch](vendor/forge-agent/README.md)
- [Retired Python baseline and behavior inventory](docs/history/retirement.md)
- [LLM Wiki](docs/research/llm-wiki.zh-CN.md) and [GraphRAG](docs/research/graphrag.zh-CN.md) learning material
