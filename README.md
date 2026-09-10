# LoreWeave

An agent-powered knowledge base with a living wiki, graph-assisted retrieval,
and source-backed answers.

The first version targets Markdown enterprise/project documents, TypeScript/Bun,
PostgreSQL with pgvector, React and the pinned Forge Agent SDK.

**Status: repository prepared; application bootstrap is next in
[#2](https://github.com/L-1ngg/loreweave/issues/2).**
The retired Python runtime is recoverable from its
[preserved baseline](docs/history/retirement.md). No new application runs yet.

## Construction entry points

- [Specification and live tasks](https://github.com/L-1ngg/loreweave/issues/1)
- [Blueprint](docs/rag-v1-blueprint.md) and [nine-module contracts](docs/design/rag-v1/README.md)
- [Task dependency map](.scratch/rag-v1/README.md)
- [Confirmed decisions](docs/rag-optimization-design.md) and [domain terms](CONTEXT.md)
- [Evaluation plan](docs/rag-evaluation-plan.md)
- [LLM Wiki](docs/research/llm-wiki.zh-CN.md) and [GraphRAG](docs/research/graphrag.zh-CN.md) learning material

## Repository checks

Install Bun, then run:

```sh
bun scripts/check-docs.mjs
git diff --check
```

These check documentation links and formatting. Application build, typecheck and
product tests arrive with #2; PostgreSQL setup arrives with persistence. Historical
Python guides are explicitly archived and are not current operating instructions.
