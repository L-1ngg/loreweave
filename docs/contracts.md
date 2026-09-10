> Historical Python-system document, applicable to `d24fb0bce6e240930bba9940ead57f371601ded8` only.
> [Original revision](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/docs/contracts.md) · [Current construction entry](https://github.com/L-1ngg/loreweave/blob/main/docs/rag-v1-blueprint.md).
> Commands and results below are archived; they do not describe the active LoreWeave runtime.

# V2 Contracts

## Elasticsearch chunk projection

The physical index starts at `rag-chunks-v2`; clients use `rag-chunks`.
Mappings are `dynamic: strict`.

Required identity and citation fields include `chunk_id`, `document_id`,
`document_revision_id`, `knowledge_base_id`, `title`, `content_with_weight`,
`section_path`, page bounds, block/asset references, source object key,
embedding profile, chunking version, ordinal, timestamps, checksum, and
enrichment provenance.

`section_path` is the complete ordered heading hierarchy. The same values are
persisted in artifact metadata as `header_path`, with `header_path_text` using
` > ` as its separator. Header context contributes to the content lexical fields
and semantic vector, while `content_with_weight` remains the unmodified evidence
returned to callers.

Lexical fields and fixed boosts are:

```json
{
  "important_kwd": 30,
  "important_tks": 20,
  "question_tks": 20,
  "title_tks": 10,
  "title_sm_tks": 5,
  "content_ltks": 2,
  "content_sm_ltks": 1
}
```

`question_kwd` stores original questions for provenance. Token fields use the
`rag_whitespace` analyzer and `rag_idf` similarity. `content_with_weight` is not
indexed. `content_vector` has fixed dimensions and cosine similarity.

Fixed filters are `source_type`, `language`, `tags`, `source_date`,
`effective_from`, `effective_to`, `created_at`, `document_id`, and
`entity_refs`.

## `search_evidence`

Input:

```json
{
  "query": "它在去年做了什么？",
  "knowledge_base_id": "default",
  "top_k": 8,
  "explicit_filters": {
    "tags": {"all": ["approved"], "none": ["draft"]}
  },
  "context": [
    {
      "user_query": "Apollo 项目是什么？",
      "resolved_query": "Apollo 项目是什么？",
      "entity_refs": ["project:apollo"],
      "time_expressions": [],
      "selected_document_id": ""
    }
  ]
}
```

Limits: query 1-2000 characters, knowledge base ID 1-128 URL-safe characters,
`top_k` 1-20, and context 0-4 turns.

Output:

```json
{
  "status": "ok",
  "resolved_query": "project:apollo 在去年做了什么？",
  "query_plan": {
    "normalization_version": "nfkc-t2s-boundary-v1",
    "raw_query": "它在去年做了什么？",
    "resolved_query": "project:apollo 在去年做了什么？",
    "lexical_query": "project:apollo 做了什么",
    "semantic_query": "project:apollo 做了什么",
    "filters": {},
    "replacements": [],
    "ambiguities": []
  },
  "knowledge_base_id": "default",
  "results": [
    {
      "rank": 1,
      "chunk_id": "chunk-id",
      "document_id": "document-id",
      "document_revision_id": "revision-id",
      "title": "Document title",
      "snippet": "Original untrusted evidence...",
      "page_start": 3,
      "page_end": 4,
      "section_path": ["Chapter", "Section"],
      "source_uri": "rag://documents/document-id/revisions/revision-id",
      "score": 0.83,
      "term_score": 0.79,
      "vector_score": 0.92,
      "asset_refs": []
    }
  ],
  "next_context": {},
  "total_candidates": 42,
  "truncated": false,
  "degraded": false
}
```

`degraded` is `true` when the configured reranker failed and the result fell
back to deterministic fusion ordering. Generated keywords and questions are
never returned as evidence.

## `answer_question`

`answer_question` is a stateless convenience use case for one retrieval plus one
grounded generation call. It accepts the same request fields and limits as
`search_evidence`:

```json
{
  "query": "日报从草稿到撤回的状态流转顺序是什么？",
  "knowledge_base_id": "default",
  "top_k": 8,
  "explicit_filters": {},
  "context": []
}
```

The service does not accept arbitrary instructions, full chat history, or an
Agentic loop. The caller may invoke the tool repeatedly and may instead compose
`search_evidence` and `get_citation_context` directly.

Successful answer output:

```json
{
  "status": "answered",
  "answer": "日报状态依次为草稿、待审核、审核中、已发布、已撤回。[1]",
  "citations": [
    {
      "marker": 1,
      "rank": 1,
      "chunk_id": "chunk-id",
      "document_id": "document-id",
      "document_revision_id": "revision-id",
      "title": "日报状态",
      "snippet": "原始证据文本...",
      "page_start": 3,
      "page_end": 3,
      "section_path": ["日报", "状态"],
      "source_uri": "rag://documents/document-id/revisions/revision-id",
      "score": 0.83,
      "term_score": 0.79,
      "vector_score": 0.92,
      "asset_refs": []
    }
  ],
  "retrieval": {
    "status": "ok",
    "resolved_query": "日报从草稿到撤回的状态流转顺序是什么？",
    "query_plan": {},
    "knowledge_base_id": "default",
    "results": [],
    "next_context": {},
    "total_candidates": 42,
    "truncated": false,
    "degraded": false
  },
  "generation": {
    "model": "answer-model",
    "prompt_version": "v1"
  }
}
```

`answer` must use inline `[n]` markers whose numbers exactly match the
structured citations. The service maps those numbers back to the original
retrieval evidence and rejects unknown, duplicate, missing, or out-of-range
references.

When the retrieval result is empty/weak, or the model determines that the
evidence is insufficient, the response is:

```json
{
  "status": "insufficient_evidence",
  "answer": null,
  "citations": [],
  "retrieval": {
    "status": "empty",
    "resolved_query": "未找到支持证据的查询",
    "query_plan": {},
    "knowledge_base_id": "default",
    "results": [],
    "next_context": {},
    "total_candidates": 0,
    "truncated": false,
    "degraded": false
  }
}
```

The actual response retains the complete `SearchEvidenceResult` in `retrieval`.
Generation does not write database rows or artifacts.
