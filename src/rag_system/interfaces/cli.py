from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, replace
import json
from pathlib import Path
import sys
import time

from ..application.generation import answer_result_to_dict
from ..application.retrieval import search_result_to_dict
from ..application.runtime import (
    build_generation_runtime,
    build_ingestion_runtime,
    build_retrieval_runtime,
    validate_runtime_state,
)
from ..application.worker import IndexManager
from .worker import ProjectionWorker
from ..domain.models import JobStatus, QueryContext
from ..infrastructure.config import Settings
from ..infrastructure.database import PostgresRepository
from ..infrastructure.database_migrations import ALEMBIC_HEAD, upgrade_database
from ..infrastructure.elasticsearch_store import ElasticsearchRepository
from ..infrastructure.object_store import S3ObjectStore
from .evaluation import run_evaluation


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rag", description="My RAG administration CLI"
    )
    parser.add_argument(
        "--config",
        dest="config_path",
        help="Override RAG_CONFIG_PATH for this command",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Create the chunk index and object bucket")

    config = commands.add_parser("config", help="Inspect RAG configuration")
    config_commands = config.add_subparsers(dest="config_command", required=True)
    config_commands.add_parser("validate", help="Validate the effective configuration")
    config_commands.add_parser("show", help="Show the effective redacted configuration")

    db = commands.add_parser("db", help="Database migration commands")
    db_commands = db.add_subparsers(dest="db_command", required=True)
    db_commands.add_parser("upgrade", help="Upgrade PostgreSQL to the Alembic head")

    import_parser = commands.add_parser("import", help="Import one document")
    import_parser.add_argument("path")
    import_parser.add_argument("--knowledge-base", default="default")
    import_parser.add_argument("--document-name")
    import_parser.add_argument("--metadata-json")
    import_parser.add_argument("--keyword", action="append", default=[])
    import_parser.add_argument("--question", action="append", default=[])
    import_parser.add_argument("--no-enrich", action="store_true")
    import_parser.add_argument(
        "--wait",
        action="store_true",
        help="Consume this process' projection event before returning",
    )

    search_parser = commands.add_parser("search", help="Run a diagnostic search")
    search_parser.add_argument("query")
    search_parser.add_argument("--knowledge-base", default="default")
    search_parser.add_argument("--top-k", type=int)
    search_parser.add_argument("--filters-json")
    search_parser.add_argument("--context-json")

    answer_parser = commands.add_parser(
        "answer", help="Generate one grounded answer from indexed evidence"
    )
    answer_parser.add_argument("query")
    answer_parser.add_argument("--knowledge-base", default="default")
    answer_parser.add_argument("--top-k", type=int)
    answer_parser.add_argument("--filters-json")
    answer_parser.add_argument("--context-json")

    evaluation = commands.add_parser("eval", help="Run end-to-end RAG evaluations")
    evaluation_commands = evaluation.add_subparsers(dest="eval_command", required=True)
    evaluation_run = evaluation_commands.add_parser(
        "run", help="Evaluate one JSONL dataset"
    )
    evaluation_run.add_argument("dataset")
    evaluation_run.add_argument("--output")
    evaluation_run.add_argument("--experiment-name")
    evaluation_run.add_argument(
        "--ragas",
        action="store_true",
        help="Enable Ragas retrieval and answer quality metrics",
    )
    evaluation_run.add_argument(
        "--verify-index",
        action="store_true",
        help="Audit PostgreSQL/S3 chunks against the active search alias",
    )

    entity = commands.add_parser("entity", help="Manage the entity registry")
    entity_commands = entity.add_subparsers(dest="entity_command", required=True)
    upsert = entity_commands.add_parser("upsert", help="Create or update one entity")
    upsert.add_argument("--knowledge-base", default="default")
    upsert.add_argument("--type", required=True, dest="entity_type")
    upsert.add_argument("--name", required=True)
    upsert.add_argument("--alias", action="append", default=[])
    upsert.add_argument("--ref")
    upsert.add_argument("--metadata-json")
    entity_import = entity_commands.add_parser(
        "import", help="Import entities from JSON"
    )
    entity_import.add_argument("path")
    entity_import.add_argument("--knowledge-base", default="default")

    index = commands.add_parser("index", help="Manage Elasticsearch projections")
    index_commands = index.add_subparsers(dest="index_command", required=True)
    rebuild = index_commands.add_parser(
        "rebuild", help="Replay artifacts to a new index"
    )
    rebuild.add_argument("--index")
    verify = index_commands.add_parser(
        "verify", help="Verify chunk counts and artifacts"
    )
    verify.add_argument("index")
    verify.add_argument(
        "--knowledge-base",
        help="Limit verification to one knowledge base (diagnostic only)",
    )
    cutover = index_commands.add_parser(
        "cutover", help="Atomically move rag-chunks alias"
    )
    cutover.add_argument("index")
    return parser


async def _run(args: argparse.Namespace) -> dict:
    settings = Settings.from_env(args.config_path)
    if args.command == "config":
        if args.config_command == "show":
            return settings.to_redacted_dict()
        return {
            "status": "valid",
            "schema_version": settings.schema_version,
            "config_path": settings.config_path,
            "profiles": settings.profile_metadata(),
        }

    if args.command == "db":
        await asyncio.to_thread(
            upgrade_database,
            settings.storage.database_url.get_secret_value(),
        )
        return {"status": "upgraded", "head": ALEMBIC_HEAD}

    if args.command == "init":
        settings.validate_storage().validate_embedding_profile()
        repository = PostgresRepository.from_settings(settings)
        search = ElasticsearchRepository.from_settings(settings)
        object_store = S3ObjectStore.from_settings(settings)
        try:
            await repository.assert_migration_head(ALEMBIC_HEAD)
            await search.ensure_index()
            await object_store.ensure_bucket()
            return {
                "status": "ready",
                "index": search.chunks_index,
                "alias": search.chunks_alias,
                "bucket": settings.storage.s3_bucket,
            }
        finally:
            await repository.close()
            await search.client.close()

    if args.command == "import":
        if args.no_enrich:
            settings = replace(
                settings,
                indexing=replace(
                    settings.indexing,
                    enrichment=replace(
                        settings.indexing.enrichment,
                        enabled=False,
                    ),
                ),
            )
        runtime = build_ingestion_runtime(settings)
        try:
            await validate_runtime_state(runtime)
            if runtime.ingestion is None:
                raise RuntimeError("ingestion runtime was not initialized")
            result = await runtime.ingestion.ingest_file(
                args.path,
                knowledge_base_id=args.knowledge_base,
                document_name=args.document_name,
                metadata=_json_object(args.metadata_json),
                keywords=args.keyword,
                questions=args.question,
                enrich=not args.no_enrich,
            )
            if args.wait and result.status is JobStatus.PROJECTION_PENDING:
                worker = ProjectionWorker(
                    repository=runtime.business_repository,
                    search=runtime.repository,
                    object_store=runtime.object_store,
                    worker_id=f"{settings.worker.id}-cli",
                    lease_seconds=settings.worker.outbox_lease_seconds,
                )
                deadline = time.monotonic() + 60
                while True:
                    status = await runtime.business_repository.get_job_status(
                        result.job_id
                    )
                    if status in {JobStatus.COMPLETED, JobStatus.FAILED}:
                        result = type(result)(**{**asdict(result), "status": status})
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError("timed out waiting for chunk projection")
                    if not await worker.process_one():
                        await asyncio.sleep(settings.worker.outbox_poll_seconds)
            return asdict(result)
        finally:
            await runtime.close()

    if args.command == "search":
        runtime = build_retrieval_runtime(settings)
        try:
            await validate_runtime_state(runtime)
            context_values = _json_list(args.context_json)
            contexts = tuple(_query_context(value) for value in context_values)
            result = await runtime.retrieval.search_evidence(
                args.query,
                args.knowledge_base,
                args.top_k,
                explicit_filters=_json_object(args.filters_json),
                context=contexts,
            )
            return search_result_to_dict(result)
        finally:
            await runtime.close()

    if args.command == "answer":
        runtime = build_generation_runtime(settings)
        try:
            await validate_runtime_state(runtime)
            if runtime.generation is None:
                raise RuntimeError("generation runtime was not initialized")
            context_values = _json_list(args.context_json)
            contexts = tuple(_query_context(value) for value in context_values)
            result = await runtime.generation.answer_question(
                args.query,
                args.knowledge_base,
                args.top_k,
                explicit_filters=_json_object(args.filters_json),
                context=contexts,
            )
            return answer_result_to_dict(result)
        finally:
            await runtime.close()

    if args.command == "eval":
        runtime = build_generation_runtime(settings)
        try:
            await validate_runtime_state(runtime)
            if runtime.generation is None:
                raise RuntimeError("generation runtime was not initialized")
            index_manager = None
            if args.verify_index:
                index_manager = IndexManager(
                    repository=runtime.business_repository,
                    search=runtime.repository,
                    object_store=S3ObjectStore.from_settings(settings),
                )
            return await run_evaluation(
                dataset_path=args.dataset,
                output_path=args.output,
                experiment_name=args.experiment_name,
                use_ragas=args.ragas,
                settings=settings,
                generation=runtime.generation,
                index_manager=index_manager,
                index_name=(
                    runtime.repository.chunks_alias if index_manager is not None else ""
                ),
            )
        finally:
            await runtime.close()

    if args.command == "entity":
        repository = PostgresRepository.from_settings(settings)
        try:
            if args.entity_command == "upsert":
                entity_ref = await repository.upsert_entity(
                    knowledge_base_id=args.knowledge_base,
                    entity_type=args.entity_type,
                    canonical_name=args.name,
                    aliases=args.alias or [args.name],
                    entity_ref=args.ref,
                    metadata=_json_object(args.metadata_json),
                )
                return {"status": "upserted", "entity_ref": entity_ref}
            values = json.loads(Path(args.path).read_text(encoding="utf-8"))
            if not isinstance(values, list):
                raise ValueError("entity import JSON must be an array")
            refs = []
            for value in values:
                if not isinstance(value, dict):
                    raise ValueError("entity import entries must be objects")
                refs.append(
                    await repository.upsert_entity(
                        knowledge_base_id=args.knowledge_base,
                        entity_type=str(value["type"]),
                        canonical_name=str(value["name"]),
                        aliases=[
                            str(item) for item in value.get("aliases", [value["name"]])
                        ],
                        entity_ref=value.get("entity_ref"),
                        metadata=value.get("metadata") or {},
                    )
                )
            return {"status": "imported", "count": len(refs), "entity_refs": refs}
        finally:
            await repository.close()

    if args.command == "index":
        repository = PostgresRepository.from_settings(settings)
        search = ElasticsearchRepository.from_settings(settings)
        object_store = S3ObjectStore.from_settings(settings)
        manager = IndexManager(
            repository=repository, search=search, object_store=object_store
        )
        try:
            if args.index_command == "rebuild":
                return asdict(await manager.rebuild(new_index=args.index))
            if args.index_command == "verify":
                return asdict(await manager.verify(args.index, args.knowledge_base))
            old = await manager.cutover(args.index)
            return {"status": "cutover", "index": args.index, "previous_indices": old}
        finally:
            await repository.close()
            await search.client.close()

    raise ValueError(f"unsupported command {args.command!r}")


def main(argv: list[str] | None = None) -> None:
    args = _build_parser().parse_args(argv)
    try:
        result = asyncio.run(_run(args))
    except Exception as exc:
        print(
            json.dumps({"error": type(exc).__name__, "message": str(exc)}),
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    print(json.dumps(result, ensure_ascii=False, default=_json_default, indent=2))
    if args.command == "eval" and result.get("status") != "ok":
        raise SystemExit(1)


def _json_object(value: str | None) -> dict:
    if not value:
        return {}
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("JSON value must be an object")
    return parsed


def _json_list(value: str | None) -> list:
    if not value:
        return []
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        raise ValueError("JSON value must be an array")
    return parsed


def _query_context(value: dict) -> QueryContext:
    value = dict(value)
    value["entity_refs"] = tuple(value.get("entity_refs") or ())
    value["time_expressions"] = tuple(value.get("time_expressions") or ())
    return QueryContext(**value)


def _json_default(value: object) -> object:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    raise TypeError(f"cannot serialize {type(value).__name__}")


if __name__ == "__main__":
    main()
