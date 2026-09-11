# Real model integration

The explicit `bun run dev:real` entry point loads `.env`, sets
`LOREWEAVE_PROVIDER_MODE=real`, and uses the configured chat and embedding services.
`bun run dev` remains a credential-free scripted development entry point.
Both need a dedicated `DATABASE_URL` as described in the root README. Never point
the new schema at the retired Python database. The provider adapter does not read
`RAG_DATABASE_URL` or migrate old data. Existing vectors must be rebuilt by
reimporting originals into a fresh database when changing embedding profiles.

Required settings (keep secrets in the local environment, not Git):

| Setting | Meaning |
| --- | --- |
| `RAG_CHAT_BASE_URL` | Chat Completions API base, including `/v1` when required |
| `RAG_CHAT_API_KEY` | Chat service credential |
| `RAG_CHAT_MODEL` | Actual model ID sent to the service |
| `LOREWEAVE_CHAT_PROVIDER` | Forge catalog/protocol selection; default `huggingface` |
| `RAG_CHAT_TIMEOUT_SECONDS` | Per-request timeout, default 45; run deadlines still apply |
| `RAG_EMBEDDING_BASE_URL` | Embeddings API base |
| `RAG_EMBEDDING_API_KEY` | Embedding service credential |
| `RAG_EMBEDDING_MODEL` | Actual embedding model ID |
| `RAG_EMBEDDING_DIMENSIONS` | Expected vector dimensions, default 1024 |
| `RAG_EMBEDDING_SEND_DIMENSIONS` | Send the optional dimensions parameter; default false |
| `RAG_EMBEDDING_BATCH_SIZE` | Sequential batch size, default 16, maximum 128 |

The selected Forge catalog entry must exist and use `openai-completions`.
`huggingface` selects the compatible catalog entry for
`deepseek-ai/DeepSeek-V4-Flash`; requests still go to `RAG_CHAT_BASE_URL`, not the
catalog's default service. A different model may require a different catalog
provider. Unknown entries fail at startup rather than masquerading as another
model. This is not a generic arbitrary-model registration implementation.

One real chat configuration serves Forge exploration, answer generation, separate
support review, and Wiki/graph maintenance. Finalization and maintenance use
tools-disabled JSON Chat Completions. Domain admission still owns retries, phase
ceilings and deadlines; the HTTP adapter never retries invisibly. Embedding
responses are ordered by index and checked for count, dimensions and finite,
nonzero vectors. HTTP bodies/errors and credentials are not written into errors.

The model returns assertion text segments. For Wiki blocks the adapter prepends
the fixed topic title as a factual claim; the independent review must support
that title too. The adapter joins all segments and computes
UTF-16 claim offsets; the existing draft validator still checks the complete
manifest. The independent reviewer supplies verbatim unique original quotes;
the adapter computes exact quote offsets and rejects invented or ambiguous
quotes. The existing review and source-freshness validators retain final authority.
No local heuristic supplies a semantic approval.

Graph extraction receives bounded, already recorded original mention IDs from
M03 (up to 80 per packet; overflow requires attention). Missing endpoint mentions
remain explicit exclusions. Automatic free-form mention discovery and general
semantic identity merging are not supplied by this adapter; see
[identity boundaries](identity.md). Wiki structure, retirement and support phases
have real-model prompts, but their actual quality requires separate scenario
evaluation. Model IDs/profiles are retained; comprehensive token/pricing telemetry
is still unavailable and must not be represented as zero cost.

## Verification

`bun run test:providers` exercises local HTTP protocol failures, exact citation
mapping and embedding integrity without paid requests. Existing host/domain
tests retain the budget, freshness and persistence checks.

For an explicitly authorized small real-provider run:

```sh
TEST_DATABASE_URL=postgres://... bun run smoke:providers
```

Use an isolated disposable PostgreSQL database: the script runs maintenance
workers and creates a fresh organization with one generated Markdown source.
It records exact Alpha/Beta mentions, builds Wiki/graph, queries the public host
through the real Forge SDK, and prints source/derived readiness, original
citations, request counts and a pass/fail integration result. It does not import
private corpus files. Artifacts contain generated sample text and IDs, not keys.
This smoke is not the 20-document preliminary exercise or the frozen #18
quality/lifecycle/routing/capacity acceptance. Model support review is not an
independent human quality grade.
