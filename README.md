# LoreWeave

An agent-powered knowledge base with a living wiki, graph-assisted retrieval,
and source-backed answers.

**Current capability: durable local development conversations (#2–#3).** A browser question runs
through the pinned Forge SDK, a scripted original-evidence tool, and separate
fixture generation/review requests. Cancel, observe progress and follow an original
citation. The example corpus and model responses are scripted; this is not yet
production RAG or a measured semantic-review implementation. PostgreSQL preserves
conversations and reconnectable runs; organization access arrives in #4 and real
source answering in #6.

## Run locally

Use Bun 1.3.12 and Node.js 24 (Vite runs through its Node CLI):

```sh
bun install --frozen-lockfile
docker compose up -d --wait postgres
export DATABASE_URL=postgres://loreweave:loreweave_local@127.0.0.1:45432/loreweave
bun run dev
```

Open <http://127.0.0.1:41735>. The API binds to `127.0.0.1:41736` and the scripted
model server uses a dynamically assigned loopback port. No provider credentials are required. The database is a dedicated local instance;
startup applies the reviewed Drizzle SQL migrations. If either fixed port is occupied, stop this
new process and resolve the conflict explicitly; it never replaces another service.
The dev command disables automatic `.env` loading for its backend.

Try “项目日志保留多久？” and follow the citation. The fixed example answers only
demonstrate the execution pipeline. Unrelated questions do not measure retrieval
or model understanding. Runs and Forge history persist across process restarts. Source fixtures are still
scripted. The conversation URL restores progress without submitting another turn. This entry point is restricted to local development until access control exists.

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
- [Pinned Forge source and local patch](vendor/forge-agent/README.md)
- [Retired Python baseline and behavior inventory](docs/history/retirement.md)
- [LLM Wiki](docs/research/llm-wiki.zh-CN.md) and [GraphRAG](docs/research/graphrag.zh-CN.md) learning material
