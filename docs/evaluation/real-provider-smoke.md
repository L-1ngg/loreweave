# Real-provider integration smoke — 2026-09-12

Integration result: **passed on the final run**. Final quality, lifecycle,
routing and capacity acceptance: **not assessed**; #18 and #1 remain open.

[Raw final result](real-provider-smoke.json) records the generated sample's
operation, source version, passage citation, separate Wiki/graph readiness,
actual model profiles and host request counts. The disposable database was
isolated from user data and will not be retained as a production instance.

- Chat: `deepseek-ai/DeepSeek-V4-Flash`, using the configured Chat Completions
  endpoint. The Forge SDK's real streaming tool round trip also passed.
- Embeddings: `BAAI/bge-m3`, 1024 dimensions; live response matched configuration.
- Input: one generated Markdown document about 30-day production-log retention
  and Alpha depending on Beta. Two exact original mentions were explicitly
  recorded through IdentityService; this does not certify automatic discovery.
- Source became searchable; Wiki and graph maintenance succeeded; graph traversal
  returned one supported relationship. Original-source citation resolved in the
  host's final answer, with an independent support-review certificate.
- Question: “生产环境的应用日志保留几天？” Answer: “生产环境的应用日志保留 30 天。”
- Measured answer execution: **13,726 ms**, one retrieval, two Forge exploration
  requests, one generation, two review requests. This is a single integration
  timing, not a p95 estimate. The second review is charged to the existing cap.

## Failures retained in the development history

Five full-chain attempts were made during implementation. The earlier failures
were not acceptance questions and were not counted as passing runs:

1. Wiki generation omitted its required heading; the publication gate rejected
   it (`unreviewed_title`). Graph and cited answering succeeded.
2. After adding the fixed heading to the reviewed claim manifest, the reviewer
   rejected a faithful topic label because its wording differed from the original
   document title (`insufficient_evidence`). The review prompt now distinguishes
   semantic support for a topic label from a claim about an original title.
3. A local HTTP-adapter variable shadowing error prevented embedding dispatch;
   the downstream smoke initially surfaced `not_found` for the inactive source.
4. The same adapter defect was surfaced as explicit source-preparation failure.
   Typechecking identified the temporal-dead-zone error; renaming the response
   variable fixed it. These were implementation defects, not provider outages.
5. Final run passed. Bounded model-output repair was still needed: maintenance
   rejected an invalid citation before a subsequent valid draft. Ordinary answer
   review consumed two attempts. A passing smoke does not imply reliable output
   formatting across an arbitrary corpus.

Both pre-commit review axes identified missing endpoint-name mapping in graph
review input. Extraction and review now share the bounded original mention
catalogue. Regression checks reject correct relationship prose paired with
swapped endpoint UUIDs, while admitting correctly bound supported relationships.

## Reproduction and limits

See [provider setup](../development/providers.md). With explicitly authorized
credentials in `.env` and a disposable PostgreSQL instance:

```sh
TEST_DATABASE_URL=postgres://... bun run smoke:providers
```

This execution used the public module/host interfaces, real PostgreSQL, real
embedding requests and real Forge/provider requests. The browser regression uses
scripted providers. No private corpus, 20-document preliminary exercise, frozen
200-question human grading, 1,000-document load, real lifecycle matrix, or model
cost acceptance was run. Comprehensive token/pricing telemetry remains unavailable.
Source update, restoration and structural-planning model quality require later
real-provider scenarios. No release or zero-hallucination claim follows from this
record.
