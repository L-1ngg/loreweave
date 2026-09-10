# LoreWeave

An agent-powered knowledge base with a living wiki, graph-assisted retrieval,
and source-backed answers.

LoreWeave is being redesigned to combine maintained Wiki pages, graph-assisted
evidence discovery, and answers grounded in original enterprise and project
documents. The first version targets Markdown sources, a TypeScript/Bun backend,
PostgreSQL with pgvector, a React interface, and Forge Agent SDK integration.

**Status: construction plan ready; the redesigned product is not implemented.**
Start with the [construction blueprint](docs/rag-v1-blueprint.md),
[specification](.scratch/rag-v1/spec.md),
[nine-module map](docs/design/rag-v1/README.md), and
[17 delivery work items](.scratch/rag-v1/README.md).
The [design record](docs/rag-optimization-design.md) captures confirmed decisions.

## Existing Python implementation (My-RAG)

The code and operating instructions below describe the earlier Python system.
They do not describe the planned LoreWeave runtime.

An MCP-first RAG service. PostgreSQL is the business source of truth, immutable
artifacts live in S3/MinIO, and Elasticsearch is a rebuildable chunk-search
projection. The service exposes both cited evidence retrieval and an optional
single-pass grounded answer; Agent orchestration remains outside the service.

Read [the architecture](docs/architecture.md) and
[the contracts](docs/contracts.md) before changing the ingestion state machine,
artifact schema, or Elasticsearch mapping.

The source tree follows five layers: `domain` (business types and policies),
`processing` (document transformation), `infrastructure` (storage and provider
adapters), `application` (use cases and workers), and `interfaces` (CLI/MCP).
The database schema is created from one development baseline with `rag db
upgrade`; compatibility migrations are intentionally not kept. When that
baseline changes, recreate the development database instead of adding a bridge
revision.

## Local dependencies

```bash
uv sync --extra dev
cp .env.example .env
docker compose up -d
```

The default Compose invocation starts PostgreSQL, Elasticsearch, MinIO, and
the bucket setup only. To run the packaged MCP service and projection worker,
enable the optional application profile:

```bash
export RAG_MCP_BEARER_TOKEN="replace-with-a-local-secret"
docker compose --profile app up -d --build
docker compose --profile app ps
```

`init` is a one-shot service that runs `rag db upgrade && rag init`; `mcp` and
`worker` start only after it exits successfully. The application containers
use the internal Compose service names for storage endpoints. The published
MCP port defaults to `127.0.0.1:18080` and can be changed with
`RAG_MCP_PUBLISHED_PORT`. The local profile still requires a bearer token; use
HTTPS and a public base URL before exposing MCP beyond loopback.

Set the MinerU, embedding, chat, and generation credentials in `.env`, export
them in the shell, then initialize explicit state:

```bash
export $(grep -v '^#' .env | xargs)
rag config validate
rag db upgrade
rag init
```

The MCP service only validates the Alembic head, the `rag-chunks` alias, and the
mapping `_meta` at startup. It never creates or migrates state implicitly.

## Configuration

Configuration has two sources with separate ownership:

- [`config/rag.yaml`](config/rag.yaml) is versioned and contains non-secret RAG
  behavior: parser/embedding choices, chunking, enrichment, retrieval,
  generation, evaluation models, and stable profile IDs.
- Environment variables contain deployment concerns: endpoints, credentials,
  TLS, timeouts/concurrency, ports, worker leases, and object-store settings.

The config path precedence is CLI `--config`, then `RAG_CONFIG_PATH`, then
`config/rag.yaml`. Profile values are not overridden by environment variables;
this keeps one reviewable source for retrieval behavior. YAML parsing rejects
missing sections, unknown fields, duplicate keys, invalid types, and invalid
cross-field values before any external client is constructed.

```bash
rag config validate
rag config show
rag --config ./config/rag.yaml config validate
```

`config show` always redacts database URLs, API keys, passwords, access keys,
and bearer tokens. Each indexing, retrieval, and evaluation profile has a
deterministic SHA-256 fingerprint. Evaluation reports persist the IDs and
fingerprints so a result can be tied to the effective behavior configuration.

## Import and projection

```bash
rag-worker
rag import ./document.pdf --knowledge-base default --wait
```

`RAG_MINERU_SUBMISSION_MODE` selects how sources reach MinerU. The default
`url` mode hands MinerU a presigned URL and requires object storage that the
remote service can reach (`RAG_S3_PUBLIC_ENDPOINT_URL` or cloud S3). `upload`
mode pushes the file bytes to a MinerU-issued upload URL instead, so a local
MinIO needs no public exposure.

Each chunk normally receives five generated keywords and three generated
questions. Manual values take precedence and the model fills only missing
slots:

```bash
rag import ./document.pdf \
  --keyword "Apollo migration" \
  --question "When did Apollo migrate?" \
  --metadata-json '{"source_date":"2026-07-01","entity_refs":["project:apollo"]}'
```

Use `--no-enrich` to skip chat calls. Lexical fields and title/content mixed
embeddings are still produced. A transient per-chunk enrichment failure is a
soft failure recorded on the job; missing chat configuration while enrichment
is enabled is a startup configuration error.

The write path is:

```text
CHUNKED -> ENRICHING -> ENRICHED -> EMBEDDED
        -> PROJECTION_PENDING -> INDEXED -> COMPLETED
```

`chunks.embedded.json` is immutable and contains original citation text,
seven lexical fields, enrichment provenance, the final vector, and checksums.
Workers and index rebuilds replay this artifact without calling a model.

Chunks retain the complete heading hierarchy in `section_path` and artifact
metadata. A `[Parent > Child > Leaf]` breadcrumb enriches lexical, enrichment,
entity, and embedding inputs without being added to returned citation text.

## Entity registry

```bash
rag entity upsert \
  --knowledge-base default \
  --type project \
  --name Apollo \
  --alias Apollo \
  --alias 阿波罗项目

rag entity import ./entities.json --knowledge-base default
```

Entity references use fixed keyword values such as `project:apollo`. Alias
changes enqueue projection rebuilds; they do not create dynamic ES fields.

## Index operations

```bash
rag index rebuild
rag index verify rag-chunks-v2-rebuild-20260723153000
rag index cutover rag-chunks-v2-rebuild-20260723153000
```

Because `rag-chunks` is shared by every knowledge base, rebuild always replays
the complete active projection. `verify --knowledge-base` is diagnostic only.
Cutover repeats global verification before atomically moving the alias. Old
indexes are retained.

## MCP

```bash
rag-mcp --transport stdio
```

For Streamable HTTP, configure `RAG_MCP_BEARER_TOKEN`. A loopback-only
deployment may use an `http://127.0.0.1` public base URL; any non-loopback
public deployment requires an HTTPS `RAG_MCP_PUBLIC_BASE_URL`.

`search_evidence` accepts `query`, `knowledge_base_id`, `top_k`, optional
`explicit_filters`, and at most four `QueryContext` values. It returns a
`QueryPlan`, term/vector/final scores, original citations, and `next_context`.

The server always registers `search_evidence`, `get_citation_context`, and
`list_documents`. It registers `answer_question` only when all generation
settings (`RAG_GENERATION_BASE_URL`, `RAG_GENERATION_API_KEY`, and
`generation.model`) are present. An incomplete generation configuration fails
startup validation; it does not silently fall back to retrieval-only mode.

`answer_question` accepts the same request shape and performs exactly one
retrieval followed by one structured generation call. It returns an answer with
`[n]` inline citation markers, validated structured citations mapped to original
chunk provenance, and the complete nested retrieval result. It is stateless and
does not implement Agentic loops or conversation storage. Empty or weak
retrieval returns `status=insufficient_evidence` with `answer=null`.

The answer tool requires the independent `RAG_GENERATION_BASE_URL` and
`RAG_GENERATION_API_KEY` deployment settings plus `generation.model` in
`config/rag.yaml`. It may point at the same endpoint as `RAG_CHAT_*`, but does
not fall back implicitly.

For a local diagnostic invocation, use the same application path through the
CLI:

```bash
rag answer "日报从草稿到撤回的状态流转顺序是什么？"
```

## RAG evaluation

The offline evaluation framework runs the real `answer_question` path: one
retrieval followed by one grounded generation. It persists the response,
citations, evidence, context IDs, `QueryPlan`, profile fingerprints, per-tag
slices, latency, scores, skips, reasons, and errors. Deterministic ID, citation,
status, hit-rate, and MRR metrics are always computed. Ragas v0.4 retrieval and
answer-quality metrics are an explicit opt-in because they call judge and
embedding models.

```bash
uv sync --extra dev --extra eval

rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name baseline-v2 \
  --output evaluation/reports/baseline-v2.json

rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name baseline-v2-index-audited \
  --verify-index \
  --output evaluation/reports/baseline-v2-index-audited.json

rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name baseline-v2-ragas \
  --ragas \
  --output evaluation/reports/baseline-v2-ragas.json
```

Evaluation requires the independent generation configuration. Ragas additionally
uses `RAG_EVAL_BASE_URL`, `RAG_EVAL_API_KEY`,
`evaluation_profile.model`, and the configured embedding provider for answer
relevancy. See [the evaluation guide](docs/evaluation.md) for the
`SingleTurnSample`-aligned JSONL contract, metric applicability, experiment
workflow, index audit, and report schema.

## Tests

```bash
uv run pytest -m "not integration"
uv run ruff check src tests migrations
uv run ruff format --check src tests migrations
```

Live database and Elasticsearch checks are opt-in and use isolated test data:

```bash
RAG_TEST_DATABASE_URL=postgresql+asyncpg://rag:rag@localhost:15432/rag \
  uv run pytest tests/test_database_integration.py -m integration
RAG_TEST_ELASTICSEARCH_URL=http://localhost:19200 \
  uv run pytest tests/test_elasticsearch_integration.py -m integration
```

Unit tests use fake providers. Full ingestion and end-to-end Ragas acceptance
requires real S3/MinIO, MinerU, embedding, and chat endpoints. End-to-end Ragas
acceptance additionally requires generation and judge endpoints; missing
generation or evaluation credentials are an explicit configuration blocker, not
a reason to substitute a mock score. See [the testing guide](docs/testing.md)
for live-infrastructure commands and Compose smoke criteria.
