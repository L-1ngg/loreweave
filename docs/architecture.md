# My RAG Architecture

Status: accepted v2 design

## Boundaries

My RAG exposes cited evidence and a single-pass grounded answer through MCP.
It does not implement an Agent, planner, server-side session, or multi-call
retrieval loop; external Agents decide how to compose the MCP tools.

## Source layout

The Python package is organized by responsibility rather than by provider name:

```text
src/rag_system/
  domain/          models, ports, lexical scoring, query planning
  processing/      normalization, cleaning, chunking, enrichment, artifacts
  infrastructure/  settings, PostgreSQL, Elasticsearch, object storage, providers
  application/     ingestion, retrieval, runtime composition, projection worker
  interfaces/      CLI and MCP entrypoints
```

`domain` has no dependency on the other source layers. `processing` depends only
on `domain`; `infrastructure` may use domain and processing contracts but never
application or interfaces. Application services compose those policies and
adapters. Interfaces own process and protocol entrypoints. These directions are
enforced by `tests/test_architecture.py`.

## Configuration boundary

`config/rag.yaml` is the versioned source of non-secret behavior. Its indexing,
retrieval, and evaluation sections have stable IDs and deterministic
fingerprints. Environment variables are limited to deployment concerns such as
URLs, credentials, TLS, timeouts/concurrency, ports, and worker leases. YAML is
strictly parsed and cross-field validated before runtime composition constructs
PostgreSQL, Elasticsearch, S3, MinerU, embedding, chat, or evaluation clients.

`Settings` is a frozen tree of typed configuration objects. Secret values have
an explicitly redacted representation and must be deliberately unwrapped only
inside infrastructure adapters. CLI config output uses the same redacted tree.

- PostgreSQL owns documents, revisions, jobs, enrichment cache, entity registry,
  document/entity links, and the transactional outbox.
- S3/MinIO owns immutable source, parser, normalized, chunk, and embedded chunk
  artifacts.
- Elasticsearch owns only the shared `rag-chunks-v2` search projection, reached
  through the `rag-chunks` alias and isolated by `knowledge_base_id`.
- MinerU parses source documents. The normalizer accepts `content_list_v2.json`
  and the `full.md` archive fallback.
- A dedicated OpenAI-compatible embedding provider creates vectors.
- A separately configured chat provider performs write-time enrichment and
  restricted multi-turn reference replacement. It does not expand queries or
  answer questions.
- A separately configured generation provider performs one structured answer
  call after retrieval. It is not used by ingestion, indexing, or query
  understanding.

## Ingestion

```text
RECEIVED -> STORED_RAW -> PARSE_SUBMITTED -> PARSE_RUNNING
         -> PARSE_SUCCEEDED -> NORMALIZED -> CHUNKED
         -> ENRICHING -> ENRICHED -> EMBEDDED
         -> PROJECTION_PENDING -> INDEXED -> COMPLETED
```

Chunking is section-aware and defaults to 512 estimated tokens with a 64-token
overlap. Normalization carries the complete heading hierarchy into every block;
each chunk stores it as `section_path`, `metadata.header_path`, and the flattened
`metadata.header_path_text`. The current strategy is identified by
`header-path-v1`, and its version plus size/overlap settings participate in the
revision fingerprint. Consecutive ancestor headings without body content are
kept in the path metadata instead of becoming heading-only chunks; a final
heading-only section is still retained.

Retrieval-only text prefixes the original body with a compact breadcrumb such
as `[Handbook > Operations > Linux]`. This contextual text is used by
enrichment, lexical proxy generation, entity matching, and semantic embedding.
It never replaces the original chunk body used for citations.

After chunking, one structured chat request per chunk asks for five keywords and
three answerable questions by default. Cache identity includes contextual-input
SHA-256, chat model, prompt version, language, and requested counts. Only
validated outputs are cached. Manual values win and reduce the requested missing
counts.

Validation covers type, exact count, length, language, uniqueness, and empty
values. A chunk gets at most two attempts. Exhaustion records provenance and
continues with empty generated fields. A missing chat configuration is rejected
before an enrichment-enabled import starts.

Seven RAGFlow-style search proxy fields are pre-tokenized at write time:

| Field | Boost | Source |
| --- | ---: | --- |
| `important_kwd` | 30 | Original generated/manual keywords |
| `important_tks` | 20 | Tokenized keywords |
| `question_tks` | 20 | Tokenized generated/manual questions |
| `title_tks` | 10 | Coarse title tokens |
| `title_sm_tks` | 5 | Fine title tokens |
| `content_ltks` | 2 | Coarse content tokens |
| `content_sm_ltks` | 1 | Fine content tokens |

`section_path` remains structured citation metadata and is not an additional
boosted ES field. Its breadcrumb is folded into `content_ltks` and
`content_sm_ltks`, preserving the fixed seven-field retrieval contract.

Embedding input is fixed:

```text
semantic_body = questions joined by newline, otherwise original chunk content
semantic_text = [header path breadcrumb] + semantic_body
vector = normalize(0.1 * embed(document title) + 0.9 * embed(semantic_text))
```

Generated fields are retrieval proxies only. `content_with_weight` preserves the
original evidence returned in citations.

The immutable `derived/chunks.embedded.json` artifact contains every projection
field, provenance, vector, per-chunk checksum, aggregate checksum, revision ID,
and processing fingerprint. Indexing and rebuild never call chat or embedding.

## Transactional projection

The ingestion transaction persists revision/artifact identity and a deterministic
outbox event together. `rag-worker` claims events with PostgreSQL row locks using
`FOR UPDATE SKIP LOCKED`, assigns a bounded lease, verifies the artifact SHA-256,
and bulk indexes deterministic `chunk_id` values with `refresh=wait_for`.

Projection activation is a separate PostgreSQL transaction after the Elasticsearch
upsert. It locks the document row, orders revisions by `(created_at,
document_revision_id)`, and changes `current_revision_id` only when the event is
at least as new as the current pointer. An out-of-order older event is marked
`SUPERSEDED` and its own Elasticsearch documents are deleted. When a newer
revision becomes active, all older revisions are marked `SUPERSEDED`, then the
worker deletes their documents from the projection. The outbox event and job are
marked complete only after that cleanup succeeds; cleanup failures release the
lease for retry and do not turn an already-active revision into `FAILED`.

Worker retries are idempotent. Rebuilds join through `documents.current_revision_id`
and therefore replay only active revisions, never stale historical chunks. Alias
or entity-link changes enqueue replay events. The worker rematches the current
knowledge-base entity aliases while projecting, so entity registry updates do not
mutate immutable artifacts.

## Query understanding

Processing order is fixed:

```text
raw query
-> restricted reference resolution
-> NFKC/full-width/traditional-to-simplified/lowercase normalization
-> deterministic time parsing
-> entity alias matching
-> QueryPlan
-> independent lexical + filtered kNN recall
-> RRF candidate fusion
-> cross-encoder rerank with deterministic fusion fallback
```

HTTP remains stateless. A request may provide at most four recent
`QueryContext` values and an optional selected document. Chat is called only if
a reference marker is detected. Every replacement must use an exact known
entity, time, or document from context; the service reconstructs the resolved
query from replacements and rejects any added terms, low confidence, or unknown
targets.

Time spans are found by bounded Chinese/English grammar and parsed against an
explicit timezone and request-service `RELATIVE_BASE`. `source_date` is the
default. Effective/valid wording creates interval-overlap filters on
`effective_from`/`effective_to`; import wording selects `created_at`. Ambiguous
dates produce an ambiguity instead of a hard filter.

Entity aliases are maintained explicitly. A longest-match trie returns a hard
filter only for a unique entity. Type hints may disambiguate; otherwise the plan
records ambiguity and does not guess. Explicit filters are intersected with
inferred filters. An empty intersection yields an explainable empty result.

## Retrieval

Recall runs as two independent Elasticsearch requests issued concurrently, each
limited to `candidate_k=64` and sharing the same filter DSL: a lexical `bool`
applying the exact seven boosts, and a filtered kNN with `num_candidates=128`.
`_source` excludes `content_vector`. The two ranked lists are fused by
reciprocal rank (`rrf_k=60`), so the candidate pool is the union of both
channels and no single channel can gate the other. A pure kNN request
restricted to the fused candidate IDs returns only `_id` and `_score`, keeping
per-candidate vector scores available for evidence and the fallback ranker.

When `retrieval_profile.rerank.enabled` is set, a Jina/TEI-compatible
cross-encoder reranks the fused top `top_n=50` candidates on the retrieval
text; the sigmoid of the raw score is the final score. A reranker failure or
timeout falls back to deterministic fusion ordering and marks the result
`degraded: true`; a partial reranker configuration fails startup validation.
Local term scoring measures normalized unigram/bigram coverage (`0.4/0.6`)
across content/title/important/questions with field weights `1/2/5/6`. The
fallback final score is:

```text
0.7 * term_score + 0.3 * vector_score
```

The default threshold is `0.2`. `max_chunks_per_document` optionally caps how
many chunks one document may contribute to the ranked results; `0` disables
folding, which keeps single-document knowledge bases fully retrievable.
Weights are service configuration, not request parameters.

## Answer generation

`GenerationService.answer_question` composes one `RetrievalService.search_evidence`
call with one structured JSON generation call. The request is stateless and
accepts the same query, filters, and bounded `QueryContext` values as retrieval.
It does not accept arbitrary prompts, full message history, or Agentic control.

The generation prompt treats retrieved snippets as untrusted data and requires
the model to return:

```json
{
  "status": "answered | insufficient_evidence",
  "answer": "string or null",
  "citations": [1, 2]
}
```

The service verifies the JSON shape, status semantics, every inline `[n]`
marker, and every citation rank before returning an answer. Citations are copied
from the original `Evidence` objects, so generated keywords/questions never
become source evidence. Invalid model output is retried once; provider failures
and repeated validation failures are returned as a redacted generation error.

No answer or generation trace is persisted in PostgreSQL, S3, or Elasticsearch.

## Operations

RAG evaluation is an offline application path. `rag eval run` calls the same
single-pass `GenerationService.answer_question` use case as MCP, including its
one `RetrievalService.search_evidence` call. Dataset loading, Ragas judging, and
report persistence are not imported into the MCP or worker runtime. Ragas and
its model-provider dependencies live in the optional `eval` extra. Evaluation
does not write PostgreSQL, S3, or Elasticsearch state.

An explicit `--verify-index` preflight reuses `IndexManager.verify` against the
active alias for each knowledge base in the dataset. It is read-only and places
PostgreSQL/S3-to-Elasticsearch chunk and checksum parity in the same report as
retrieval metrics. Verification failures mark the run partial without hiding
case-level retrieval and answer evidence.

The evaluation dataset combines the input-side fields of Ragas
`SingleTurnSample` with My-RAG execution fields. The runtime supplies retrieved
contexts/IDs and the generated response before judging. Deterministic metrics
use reviewed chunk IDs for retrieval and citations, while optional Ragas
collections metrics evaluate context precision/recall, faithfulness, factual
correctness, and answer relevancy. Ragas receives original snippets plus
`section_path`; generated enrichment fields never become evidence. Unanswerable
cases are scored by expected response status and skip metrics whose
reference/response inputs are undefined.

- `rag db upgrade` is the only schema initialization command. The development
  database has one clean Alembic baseline, `0001_initial`; no compatibility
  migration chain is maintained.
- MCP startup read-only validates Alembic head, alias presence, and mapping
  `_meta`.
- `docker compose --profile app up -d --build` runs the one-shot `init` service,
  then starts retrieval/generation-capable MCP and the outbox worker. With empty
  generation settings, the MCP process intentionally exposes retrieval tools
  only; a partial generation configuration fails validation.
- Rebuild replays all active PostgreSQL revision pointers and S3 artifacts to a
  new physical index, then verifies the complete shared projection. A scoped
  knowledge-base verification is diagnostic and cannot establish cutover safety.
- Cutover repeats global verification before atomically moving the alias. Old
  physical indexes are never deleted automatically.
