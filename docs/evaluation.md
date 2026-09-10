> Historical Python-system document, applicable to `d24fb0bce6e240930bba9940ead57f371601ded8` only.
> [Original revision](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/docs/evaluation.md) · [Current construction entry](https://github.com/L-1ngg/loreweave/blob/main/docs/rag-v1-blueprint.md).
> Commands and results below are archived; they do not describe the active LoreWeave runtime.

# End-to-End RAG Evaluation

The offline evaluation target is the complete `answer_question` use case: one
real retrieval followed by one real generation call. Evaluation remains outside
the MCP and worker runtimes and never writes PostgreSQL, S3, or Elasticsearch.

This design follows the Ragas stable guidance for
[RAG evaluation](https://docs.ragas.org.cn/en/stable/tutorials/rag/),
[iterative improvement](https://docs.ragas.org.cn/en/stable/howtos/applications/evaluate-and-improve-rag/),
[evaluation samples](https://docs.ragas.org.cn/en/stable/concepts/components/eval_sample/),
and [metric selection](https://docs.ragas.org.cn/en/stable/concepts/metrics/overview/).
The implementation is pinned to the Ragas `0.4.x` collections API.

## Evaluation principles

- Start with end-to-end answer quality, then use component metrics to locate a
  failure in retrieval, generation, citations, or abstention.
- Keep each metric focused on one interpretable aspect. A few strong signals are
  preferred to a large collection of overlapping judge scores.
- Preserve deterministic ID metrics alongside LLM metrics. Judge metrics are
  more semantic but can vary and must be aligned against human labels before
  they become release gates.
- Compare a named baseline and candidate on the same dataset SHA-256, changing
  one indexing, retrieval, model, or prompt variable at a time.
- Keep every case, raw response, retrieved context, score, reason, skip, and
  error. Aggregate means are not enough for error analysis.

## Install and configure

Ragas is an offline-only optional dependency:

```bash
uv sync --extra dev --extra eval
```

An end-to-end run requires the normal storage, embedding, retrieval, and
generation settings. Ragas judge calls use an independent endpoint:

```bash
export RAG_GENERATION_BASE_URL=https://api.example.com/v1
export RAG_GENERATION_API_KEY=...

export RAG_EVAL_BASE_URL=https://api.example.com/v1
export RAG_EVAL_API_KEY=...
export RAG_EVAL_TIMEOUT_SECONDS=180
export RAG_EVAL_CONCURRENCY=2
```

Set stable model/profile identities in `config/rag.yaml`:

```yaml
generation:
  model: answer-model
  prompt_version: v1

evaluation_profile:
  id: ragas-core-v2
  model: judge-model
```

`AnswerRelevancy` uses the configured `indexing_profile.embedding.model` and
the independent `RAG_EMBEDDING_*` endpoint. Judge and generation settings never
fall back to `RAG_CHAT_*`. Reports store model names and profile fingerprints,
but never API keys.

## Dataset contract

Datasets are UTF-8 JSONL. Each row combines the input-side Ragas
`SingleTurnSample` fields with My-RAG routing fields. The runtime adds
`retrieved_contexts`, `retrieved_context_ids`, and `response` before constructing
the actual sample passed to Ragas. Unknown fields and duplicate `case_id` values
fail loading.

Answered case:

```json
{
  "case_id": "apollo-001",
  "user_input": "Apollo 何时迁移？",
  "reference": "Apollo 在 7 月迁移。",
  "reference_context_ids": ["chunk-id"],
  "expected_response_status": "answered",
  "knowledge_base_id": "default",
  "top_k": 8,
  "explicit_filters": {},
  "context": [],
  "reference_contexts": [],
  "rubrics": {},
  "tags": ["zh", "date"],
  "persona_name": "",
  "query_style": "",
  "query_length": ""
}
```

Unanswerable case:

```json
{
  "case_id": "unknown-001",
  "user_input": "文档没有覆盖的问题是什么答案？",
  "reference": "",
  "reference_context_ids": [],
  "expected_response_status": "insufficient_evidence",
  "tags": ["zh", "unanswerable"]
}
```

Required for every case:

- `case_id`: stable unique identity.
- `user_input`: exact question sent to `answer_question`.
- `expected_response_status`: `answered` or `insufficient_evidence`; defaults
  to `answered`.

Answered cases additionally require a reviewed `reference` answer and at least
one `reference_context_ids` chunk ID. Unanswerable cases must leave reference
content and IDs empty so an invented ground truth cannot hide a bad abstention.

Optional Ragas fields are `reference_contexts`, `rubrics`, `persona_name`,
`query_style`, and `query_length`. Optional My-RAG routing fields are
`knowledge_base_id`, `top_k`, `explicit_filters`, and up to four `context`
objects. `tags` drive report slices such as language, query type, difficulty,
and answerability.

The reviewed datasets are:

- `evaluation/datasets/ai-news-requirements-real-v1.jsonl`: restored 12-case
  retrieval baseline using real chunk IDs.
- `evaluation/datasets/ai-news-requirements-rag-v2.jsonl`: 15-case end-to-end
  baseline that adds a hard ranking paraphrase, an English query, and an
  unanswerable query.
- `evaluation/datasets/ai-news-requirements-rag-v2-ragas-smoke.jsonl`: fixed
  two-case wiring check with one answered state-flow query and one unanswerable
  query. It verifies real generation, abstention, and judge integration, but is
  too small to support quality claims or release thresholds.

## Run an experiment

Run the complete system with deterministic metrics only:

```bash
rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name baseline-v2 \
  --output evaluation/reports/baseline-v2.json
```

Add the Ragas core metric suite:

```bash
rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name baseline-v2-ragas \
  --ragas \
  --output evaluation/reports/baseline-v2-ragas.json
```

Use the fixed smoke subset before an expensive full judge run:

```bash
rag eval run evaluation/datasets/ai-news-requirements-rag-v2-ragas-smoke.jsonl \
  --experiment-name ragas-wiring-smoke \
  --verify-index \
  --ragas \
  --output evaluation/reports/ragas-wiring-smoke.json
```

A smoke failure is diagnostic evidence, not a score to average into the full
dataset. Keep failed attempts as separate experiment reports so provider or
generation-schema instability is visible.

Add a read-only index audit for release validation or retrieval diagnosis:

```bash
rag eval run evaluation/datasets/ai-news-requirements-rag-v2.jsonl \
  --experiment-name release-candidate-v2 \
  --verify-index \
  --ragas \
  --output evaluation/reports/release-candidate-v2.json
```

The audit compares active PostgreSQL/S3 revision artifacts with the
Elasticsearch alias, including chunk counts and checksums. Audit failure marks
the report partial without hiding completed case results.

## Metrics

### Deterministic metrics

These metrics have no judge cost:

| Metric | Meaning |
| --- | --- |
| `id_based_context_precision` | Retrieved chunk IDs found in reviewed reference IDs divided by unique retrieved IDs. This matches Ragas `IDBasedContextPrecision`. |
| `id_based_context_recall` | Reviewed reference IDs found in retrieved IDs divided by all reviewed IDs. This matches Ragas `IDBasedContextRecall`. |
| `hit_rate_at_k` | Whether at least one reviewed context appears in the returned results. |
| `mrr` | Reciprocal rank of the first reviewed context. |
| `response_status_accuracy` | Whether the system answered or abstained as expected. |
| `citation_precision` | Cited chunk IDs found in the reviewed context IDs divided by unique cited IDs. |
| `citation_recall` | Reviewed context IDs cited by the answer divided by all reviewed IDs. |

Undefined metrics are recorded under `metric_skips` instead of being converted
to a misleading zero. Sparse gold labels can make ID and citation precision
conservative; inspect the semantic context metric and case evidence together.

### Ragas core metrics

With `--ragas`, the collections API creates a Ragas `SingleTurnSample` and runs:

| Metric | Inputs | Diagnostic question |
| --- | --- | --- |
| `context_precision` | question, reference, ordered retrieved contexts | Are useful chunks ranked before irrelevant chunks? |
| `context_recall` | question, reference, retrieved contexts | Can every claim in the reference be attributed to retrieved evidence? |
| `faithfulness` | question, response, retrieved contexts | Are response claims supported by retrieved evidence? |
| `factual_correctness` | response, reference | Does the response contain correct and complete reference claims? |
| `answer_relevancy` | question, response, evaluation embeddings | Does the response directly address the question without evasion? |

Ragas receives only original snippets prefixed with their full
`[Parent > Child]` section path. Generated keywords and generated questions are
retrieval signals and never evaluation evidence. Metrics run concurrently, and
a failure in one metric preserves deterministic scores and all successful judge
scores for that case.

`NoiseSensitivity`, `ContextEntityRecall`, `AnswerAccuracy`, rubric metrics,
and `QuotedSpansAlignment` are not part of the core suite. They should be added
to targeted diagnostic datasets when noise, entity coverage, judge redundancy,
business rubrics, or verbatim quotations are the failure under investigation.
Agent and multi-turn metrics do not apply to this stateless single-pass RAG use
case.

## Report and analysis

Reports use schema `rag-evaluation-v3` and include:

- experiment name, timestamps, dataset path/SHA-256/case count, Ragas version,
  judge model, evaluation embedding model, and profile fingerprints;
- system and judge latency summaries;
- per-tag slices with status counts and metric count/mean/min/max;
- each source case, response status/text, structured citations, generation
  metadata, full retrieval trace and `QueryPlan`, contexts and IDs supplied to
  Ragas, metric scores/reasons/skips/errors, and per-case latency;
- optional index verification with per-knowledge-base checksum coverage.

When generation fails after retrieval, the case remains `failed`, while the
completed retrieval trace and deterministic retrieval metrics are preserved.
Response, citation, and judge metrics are recorded as explicit skips rather
than zeroes.

Use Ragas' evaluation-driven loop: run a named baseline, inspect failed rows and
metric reasons, identify whether retrieval or generation is the bottleneck,
change one variable, then run a named candidate on the same dataset SHA-256.
Do not set CI thresholds from the current one-document dataset. First expand and
human-review a representative holdout set, align the judge against expert labels,
and measure run-to-run variance.

Ragas synthetic test generation can supplement real queries by building a
knowledge graph, applying document-specific transforms, and sampling personas,
query styles, lengths, and single/multi-hop distributions. Generated cases must
be reviewed and frozen before they become regression or release gates; they do
not replace production queries or manually verified context IDs.
