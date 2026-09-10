# LoreWeave

An agent-powered knowledge base with a living wiki, graph-assisted retrieval,
and source-backed answers.

**Current capability: local development bootstrap (#2).** A browser question runs
through the pinned Forge SDK, a scripted original-evidence tool, and separate
fixture generation/review requests. Cancel, observe progress and follow an original
citation. The example corpus and model responses are scripted; this is not yet
production RAG or a measured semantic-review implementation. Conversation persistence
arrives in #3, organization access in #4 and real source answering in #6.

## Run locally

Use Bun 1.3.12 and Node.js 24 (Vite runs through its Node CLI):

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:41735>. The API binds to `127.0.0.1:41736` and the scripted
model server uses a dynamically assigned loopback port. No provider credentials,
database or `.env` setup is required. If either fixed port is occupied, stop this
new process and resolve the conflict explicitly; it never replaces another service.
The dev command disables automatic `.env` loading for its backend.

Try “项目日志保留多久？” and follow the citation. The fixed example answers only
demonstrate the execution pipeline. Unrelated questions do not measure retrieval
or model understanding. All runs and source fixtures disappear when this process
ends. This entry point is restricted to local development until access control exists.

## Checks

```sh
bun run typecheck
bun run format:check
bun run check:docs
bun run check:vendor
bun run test
bun run test:upstream
bun x playwright install chromium
bun run test:browser
bun run build
```

Host/HTTP tests use real loopback provider requests and observable outcomes.
Browser tests exercise the real UI and API. These checks prove the bootstrap
boundary; PostgreSQL, real-provider answer quality and capacity acceptance belong
to later tickets. `build` emits the browser bundle; `dev` is the current local
runtime, not a production deployment command.

## Construction and provenance

- [Specification and live tasks](https://github.com/L-1ngg/loreweave/issues/1)
- [Blueprint](docs/rag-v1-blueprint.md) and [nine-module contracts](docs/design/rag-v1/README.md)
- [Task dependency map](.scratch/rag-v1/README.md)
- [Confirmed decisions](docs/rag-optimization-design.md) and [domain terms](CONTEXT.md)
- [Evaluation plan](docs/rag-evaluation-plan.md)
- [Pinned Forge source and local patch](vendor/forge-agent/README.md)
- [Retired Python baseline and behavior inventory](docs/history/retirement.md)
- [LLM Wiki](docs/research/llm-wiki.zh-CN.md) and [GraphRAG](docs/research/graphrag.zh-CN.md) learning material
