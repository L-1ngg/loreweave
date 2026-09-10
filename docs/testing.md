# Testing and Local Verification

The default test command excludes live-infrastructure checks. This keeps the
unit suite deterministic while making every external dependency explicit.

## Unit and static checks

```bash
uv sync --extra dev
uv run pytest -m "not integration"
uv run ruff check src tests migrations
uv run ruff format --check src tests migrations
```

The unit suite uses fake storage and model providers. It covers the retrieval,
generation, MCP contracts, worker ordering, configuration validation, and
projection cleanup paths without requiring credentials.

## Live integration checks

Start the isolated development dependencies first. The current checkout uses
PostgreSQL `15432` and Elasticsearch `19200` to avoid host-port conflicts; use
any equivalent reachable endpoints when running elsewhere (the `.env.example`
defaults are `5432` and `9200`).

```bash
RAG_TEST_DATABASE_URL=postgresql+asyncpg://rag:rag@localhost:15432/rag \
  uv run pytest tests/test_database_integration.py -m integration
RAG_TEST_ELASTICSEARCH_URL=http://localhost:19200 \
  uv run pytest tests/test_elasticsearch_integration.py -m integration
```

The PostgreSQL test creates and drops a temporary schema for each run. The
Elasticsearch test creates and deletes a temporary physical index. If the
corresponding environment variable is absent, the test is skipped rather than
silently using a developer database or index.

## Compose smoke test

```bash
RAG_MCP_BEARER_TOKEN=local-smoke-token \
  docker compose --profile app config --quiet
RAG_MCP_BEARER_TOKEN=local-smoke-token \
  docker compose --profile app up -d --build
RAG_MCP_BEARER_TOKEN=local-smoke-token docker compose --profile app ps
RAG_MCP_BEARER_TOKEN=local-smoke-token \
  docker compose --profile app logs --no-log-prefix init
```

The expected lifecycle is: `init` exits with code 0, `mcp` becomes healthy, and
`worker` remains running. With empty generation settings, an MCP `tools/list`
request must contain exactly `search_evidence`, `get_citation_context`, and
`list_documents`; `answer_question` appears only after complete generation
configuration is supplied. The example token is for a loopback smoke test only;
set a deployment secret for any shared or public listener.

## Ragas evaluation boundary

Ragas is an optional offline extra:

```bash
uv sync --extra dev --extra eval
```

An end-to-end run requires independent generation and judge settings, including
`RAG_GENERATION_BASE_URL`, `RAG_GENERATION_API_KEY`, `generation.model`,
`RAG_EVAL_BASE_URL`, `RAG_EVAL_API_KEY`, and `evaluation_profile.model`. These
values are intentionally not invented or added to `.env`; until they are
provided, deterministic retrieval tests remain the highest valid verification
level. See [the evaluation guide](evaluation.md) for the dataset contract and
metric selection.
