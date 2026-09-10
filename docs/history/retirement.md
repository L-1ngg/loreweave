# Repository retirement baseline

Implemented for [#19](https://github.com/L-1ngg/loreweave/issues/19).
Preserved tracked baseline: `d24fb0bce6e240930bba9940ead57f371601ded8`, verified through the GitHub commit API.

[Browse the complete original tree](https://github.com/L-1ngg/loreweave/tree/d24fb0bce6e240930bba9940ead57f371601ded8).
Recover into a separate checkout, leaving the current workspace and local state intact:

```sh
git worktree add --detach ../loreweave-python-history d24fb0bce6e240930bba9940ead57f371601ded8
```

This recovers tracked code only. Local credentials, virtual environments, data,
volumes and running services were outside this change. Starting old services or
migrating data is a separate operational action.

## File disposition

All removed files are listed below. Old executable code is retained in Git history,
not copied into a second maintained runtime.

| Original file | Disposition |
| --- | --- |
| [.dockerignore](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/.dockerignore) | Retired; recover from pinned baseline |
| [.env.example](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/.env.example) | Retired; recover from pinned baseline |
| [Dockerfile](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/Dockerfile) | Retired; recover from pinned baseline |
| [alembic.ini](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/alembic.ini) | Retired; recover from pinned baseline |
| [compose.yaml](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/compose.yaml) | Retired; recover from pinned baseline |
| [config/rag.yaml](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/config/rag.yaml) | Retired; recover from pinned baseline |
| [evaluation/datasets/ai-news-requirements-rag-v2-ragas-smoke.jsonl](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/evaluation/datasets/ai-news-requirements-rag-v2-ragas-smoke.jsonl) | Retired; recover from pinned baseline |
| [evaluation/datasets/ai-news-requirements-rag-v2.jsonl](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/evaluation/datasets/ai-news-requirements-rag-v2.jsonl) | Retired; recover from pinned baseline |
| [evaluation/datasets/ai-news-requirements-real-v1.jsonl](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/evaluation/datasets/ai-news-requirements-real-v1.jsonl) | Retired; recover from pinned baseline |
| [migrations/env.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/migrations/env.py) | Retired; recover from pinned baseline |
| [migrations/script.py.mako](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/migrations/script.py.mako) | Retired; recover from pinned baseline |
| [migrations/versions/0001_initial.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/migrations/versions/0001_initial.py) | Retired; recover from pinned baseline |
| [pyproject.toml](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/pyproject.toml) | Retired; recover from pinned baseline |
| [src/rag_system/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/__main__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/__main__.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/evaluation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/evaluation.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/generation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/generation.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/ingestion.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/ingestion.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/retrieval.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/retrieval.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/runtime.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/runtime.py) | Retired; recover from pinned baseline |
| [src/rag_system/application/worker.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/application/worker.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/evaluation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/evaluation.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/fusion.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/fusion.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/lexical.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/lexical.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/models.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/models.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/ports.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/ports.py) | Retired; recover from pinned baseline |
| [src/rag_system/domain/query_understanding.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/query_understanding.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/config.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/config.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/database.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/database.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/database_migrations.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/database_migrations.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/elasticsearch_store.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/elasticsearch_store.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/object_store.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/object_store.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/providers/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/providers/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/providers/chat_provider.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/providers/chat_provider.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/providers/embeddings.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/providers/embeddings.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/providers/mineru.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/providers/mineru.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/providers/reranker.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/providers/reranker.py) | Retired; recover from pinned baseline |
| [src/rag_system/infrastructure/ragas_evaluator.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/ragas_evaluator.py) | Retired; recover from pinned baseline |
| [src/rag_system/interfaces/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/interfaces/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/interfaces/cli.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/interfaces/cli.py) | Retired; recover from pinned baseline |
| [src/rag_system/interfaces/evaluation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/interfaces/evaluation.py) | Retired; recover from pinned baseline |
| [src/rag_system/interfaces/mcp_server.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/interfaces/mcp_server.py) | Retired; recover from pinned baseline |
| [src/rag_system/interfaces/worker.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/interfaces/worker.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/__init__.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/__init__.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/artifacts.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/artifacts.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/chunking.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/chunking.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/cleaning.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/cleaning.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/embedding.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/embedding.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/enrichment.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/enrichment.py) | Retired; recover from pinned baseline |
| [src/rag_system/processing/normalization.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/normalization.py) | Retired; recover from pinned baseline |
| [tests/test_architecture.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_architecture.py) | Retired; recover from pinned baseline |
| [tests/test_artifacts.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_artifacts.py) | Retired; recover from pinned baseline |
| [tests/test_chat_provider.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_chat_provider.py) | Retired; recover from pinned baseline |
| [tests/test_config.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_config.py) | Retired; recover from pinned baseline |
| [tests/test_database_integration.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_database_integration.py) | Retired; recover from pinned baseline |
| [tests/test_elasticsearch_integration.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_elasticsearch_integration.py) | Retired; recover from pinned baseline |
| [tests/test_elasticsearch_store.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_elasticsearch_store.py) | Retired; recover from pinned baseline |
| [tests/test_embeddings.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_embeddings.py) | Retired; recover from pinned baseline |
| [tests/test_enrichment.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_enrichment.py) | Retired; recover from pinned baseline |
| [tests/test_evaluation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_evaluation.py) | Retired; recover from pinned baseline |
| [tests/test_generation.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_generation.py) | Retired; recover from pinned baseline |
| [tests/test_ingestion.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_ingestion.py) | Retired; recover from pinned baseline |
| [tests/test_mcp_server.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_mcp_server.py) | Retired; recover from pinned baseline |
| [tests/test_mineru.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_mineru.py) | Retired; recover from pinned baseline |
| [tests/test_normalization.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_normalization.py) | Retired; recover from pinned baseline |
| [tests/test_object_store.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_object_store.py) | Retired; recover from pinned baseline |
| [tests/test_query_understanding.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_query_understanding.py) | Retired; recover from pinned baseline |
| [tests/test_reranker.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_reranker.py) | Retired; recover from pinned baseline |
| [tests/test_retrieval.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_retrieval.py) | Retired; recover from pinned baseline |
| [tests/test_worker.py](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_worker.py) | Retired; recover from pinned baseline |
| [uv.lock](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/uv.lock) | Retired; recover from pinned baseline |

Retained files: current design/modules/policies, accepted ADRs, glossary, learning
material and archived `.scratch/rag-v1` snapshots. The historical architecture,
contracts, testing/evaluation guides and reports carry explicit baseline banners.
README, AGENTS and CI now describe the pre-bootstrap tree. `.gitignore` retains
credential and old local-cache rules so retirement does not expose local state.

The old datasets are historical examples only; #17/#18 must review source access,
labels, corpus versions and leakage before adopting any case. Historical Ragas
scores certify neither the new engine nor its quality targets.

## Behavior cases to re-express

| Historical example | Retained behavior and changed boundary | Owner |
| --- | --- | --- |
| [Citation mapping](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_generation.py#L89) | Citations resolve to original evidence; add semantic review under V01 | #6 / M06 |
| [Duplicate ingest](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_ingestion.py#L368) | Idempotent accepted request; use operation key plus payload, not implicit content-based document identity | #5 / M02 |
| [Out-of-order revision](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_worker.py#L222) | A late worker cannot reactivate obsolete content; use current pointers and fencing | #7, #16 / M02, M08 |
| [Cleanup failure](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_worker.py#L255) | A downstream failure does not undo an activated source; expose separate readiness | #7, #16 / M02, M08 |
| [Embedding failure](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_ingestion.py#L548) | Preparation failure preserves prior current evidence and a durable failure outcome | #5, #7 / M02 |
| [Database race](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/tests/test_database_integration.py#L46) | Check concurrent activation at real PostgreSQL command boundaries | #7 / M02 |

These are behavior inputs, not copied test implementations or passing evidence.

## Deferred capabilities

PDF/DOCX/OCR require a demonstrated binary-document workload and extraction-quality
evaluation. Global Search requires corpus-wide synthesis demand and comparative
evaluation. Fine-grained permissions require an actual project visibility boundary.
Their future reconsideration does not add dormant runtime switches today.

## Verification boundary

Run `bun scripts/check-docs.mjs` and `git diff --check`. Review the deletion inventory
against this baseline. This intermediate tree has no application typecheck or product
test suite; #2 introduces the Bun application and its executable checks.
