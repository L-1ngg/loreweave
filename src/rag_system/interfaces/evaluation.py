from __future__ import annotations

from dataclasses import asdict, fields
from datetime import UTC, datetime
from hashlib import sha256
from importlib.metadata import version as package_version
import json
from pathlib import Path
from typing import Any

from ..application.evaluation import RAGEvaluator
from ..application.generation import GenerationService
from ..application.worker import IndexManager
from ..domain.evaluation import EvaluationCase
from ..domain.models import QueryContext
from ..infrastructure.config import Settings
from ..infrastructure.ragas_evaluator import RagasJudge


_CASE_FIELDS = {
    "case_id",
    "user_input",
    "reference",
    "reference_contexts",
    "reference_context_ids",
    "expected_response_status",
    "knowledge_base_id",
    "top_k",
    "explicit_filters",
    "context",
    "rubrics",
    "tags",
    "persona_name",
    "query_style",
    "query_length",
}
_CONTEXT_FIELDS = {item.name for item in fields(QueryContext)}
_RESPONSE_STATUSES = {"answered", "insufficient_evidence"}


def load_evaluation_dataset(path: str | Path) -> list[EvaluationCase]:
    dataset_path = Path(path)
    cases: list[EvaluationCase] = []
    seen_ids: set[str] = set()
    with dataset_path.open(encoding="utf-8") as dataset:
        for line_number, line in enumerate(dataset, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{dataset_path}:{line_number}: invalid JSON: {exc.msg}"
                ) from exc
            try:
                case = _parse_case(value)
            except (TypeError, ValueError, KeyError) as exc:
                raise ValueError(f"{dataset_path}:{line_number}: {exc}") from exc
            if case.case_id in seen_ids:
                raise ValueError(
                    f"{dataset_path}:{line_number}: duplicate case_id {case.case_id!r}"
                )
            seen_ids.add(case.case_id)
            cases.append(case)
    if not cases:
        raise ValueError(f"{dataset_path}: evaluation dataset cannot be empty")
    return cases


async def run_evaluation(
    *,
    dataset_path: str | Path,
    output_path: str | Path | None,
    experiment_name: str | None,
    use_ragas: bool,
    settings: Settings,
    generation: GenerationService,
    index_manager: IndexManager | None = None,
    index_name: str = "",
) -> dict[str, Any]:
    cases = load_evaluation_dataset(dataset_path)
    judge = RagasJudge.from_settings(settings) if use_ragas else None
    try:
        index_verification = (
            await _verify_index(index_manager, index_name, cases)
            if index_manager is not None
            else {"status": "not_run"}
        )
        evaluator = RAGEvaluator(
            generation,
            judge=judge,
            concurrency=settings.evaluation.concurrency,
        )
        report = await evaluator.run(cases)
    finally:
        if judge is not None:
            await judge.close()

    dataset = Path(dataset_path)
    destination = Path(output_path) if output_path else _default_report_path(dataset)
    report["experiment_name"] = experiment_name or destination.stem
    report["dataset"] = {
        "path": str(dataset),
        "sha256": sha256(dataset.read_bytes()).hexdigest(),
        "case_count": len(cases),
    }
    report["profiles"] = settings.profile_metadata()
    report["index_verification"] = index_verification
    report["judge"] = (
        {
            "provider": "ragas",
            "version": package_version("ragas"),
            "model": settings.evaluation.model,
            "embedding_model": settings.embedding.model,
            "metrics": list(judge.metric_names),
        }
        if judge is not None
        else None
    )
    summary = report["summary"]
    summary["index_verification_status"] = index_verification["status"]
    if (
        index_verification["status"] in {"failed", "error"}
        and summary["status"] == "ok"
    ):
        summary["status"] = "partial"
    write_evaluation_report(report, destination)
    return {
        "status": summary["status"],
        "report_path": str(destination),
        "experiment_name": report["experiment_name"],
        "summary": summary,
    }


async def _verify_index(
    manager: IndexManager,
    index_name: str,
    cases: list[EvaluationCase],
) -> dict[str, Any]:
    if not index_name:
        raise ValueError("index name is required when index verification is enabled")
    results: list[dict[str, Any]] = []
    for knowledge_base_id in sorted({case.knowledge_base_id for case in cases}):
        try:
            verification = await manager.verify(index_name, knowledge_base_id)
        except Exception as exc:
            results.append(
                {
                    "status": "error",
                    "knowledge_base_id": knowledge_base_id,
                    "error": _error_summary(exc),
                }
            )
            continue
        result = asdict(verification)
        result["status"] = "passed" if verification.verified else "failed"
        results.append(result)

    statuses = {result["status"] for result in results}
    if "error" in statuses:
        status = "error"
    elif "failed" in statuses:
        status = "failed"
    else:
        status = "passed"
    return {"status": status, "index": index_name, "knowledge_bases": results}


def write_evaluation_report(report: dict[str, Any], path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    try:
        temporary.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, default=_json_default)
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def _parse_case(value: object) -> EvaluationCase:
    if not isinstance(value, dict):
        raise TypeError("each dataset row must be a JSON object")
    unknown = set(value) - _CASE_FIELDS
    if unknown:
        raise ValueError(f"unknown fields: {', '.join(sorted(unknown))}")

    case_id = _required_string(value, "case_id")
    user_input = _required_string(value, "user_input")
    knowledge_base_id = _optional_string(value, "knowledge_base_id", "default")
    top_k = value.get("top_k", 8)
    if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= 20:
        raise ValueError("top_k must be an integer between 1 and 20")
    explicit_filters = value.get("explicit_filters", {})
    if not isinstance(explicit_filters, dict):
        raise TypeError("explicit_filters must be an object")

    expected_status = _optional_string(value, "expected_response_status", "answered")
    if expected_status not in _RESPONSE_STATUSES:
        raise ValueError(
            "expected_response_status must be 'answered' or 'insufficient_evidence'"
        )
    reference = _optional_string(value, "reference", "")
    reference_contexts = _string_tuple(value, "reference_contexts")
    reference_context_ids = _string_tuple(value, "reference_context_ids")
    if expected_status == "answered":
        if not reference:
            raise ValueError("reference is required for answered cases")
        if not reference_context_ids:
            raise ValueError("reference_context_ids are required for answered cases")
    elif reference or reference_contexts or reference_context_ids:
        raise ValueError(
            "insufficient_evidence cases must not define reference content or IDs"
        )

    raw_context = value.get("context", [])
    if not isinstance(raw_context, list) or len(raw_context) > 4:
        raise TypeError("context must be an array with at most four entries")
    return EvaluationCase(
        case_id=case_id,
        user_input=user_input,
        reference=reference,
        reference_context_ids=reference_context_ids,
        expected_response_status=expected_status,
        knowledge_base_id=knowledge_base_id,
        top_k=top_k,
        explicit_filters=dict(explicit_filters),
        context=tuple(_parse_context(item) for item in raw_context),
        reference_contexts=reference_contexts,
        rubrics=_string_mapping(value, "rubrics"),
        tags=_string_tuple(value, "tags"),
        persona_name=_optional_string(value, "persona_name", ""),
        query_style=_optional_string(value, "query_style", ""),
        query_length=_optional_string(value, "query_length", ""),
    )


def _parse_context(value: object) -> QueryContext:
    if not isinstance(value, dict):
        raise TypeError("context entries must be objects")
    unknown = set(value) - _CONTEXT_FIELDS
    if unknown:
        raise ValueError(f"unknown context fields: {', '.join(sorted(unknown))}")
    return QueryContext(
        user_query=_required_string(value, "user_query"),
        resolved_query=_optional_string(value, "resolved_query", ""),
        entity_refs=_string_tuple(value, "entity_refs"),
        time_expressions=_string_tuple(value, "time_expressions"),
        selected_document_id=_optional_string(value, "selected_document_id", ""),
    )


def _required_string(value: dict[str, Any], name: str) -> str:
    parsed = value.get(name)
    if not isinstance(parsed, str) or not parsed.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return parsed.strip()


def _optional_string(value: dict[str, Any], name: str, default: str) -> str:
    parsed = value.get(name, default)
    if not isinstance(parsed, str):
        raise TypeError(f"{name} must be a string")
    return parsed.strip()


def _string_tuple(value: dict[str, Any], name: str) -> tuple[str, ...]:
    parsed = value.get(name, [])
    if not isinstance(parsed, list) or any(
        not isinstance(item, str) or not item.strip() for item in parsed
    ):
        raise TypeError(f"{name} must be an array of non-empty strings")
    return tuple(dict.fromkeys(item.strip() for item in parsed))


def _string_mapping(value: dict[str, Any], name: str) -> dict[str, str]:
    parsed = value.get(name, {})
    if not isinstance(parsed, dict) or any(
        not isinstance(key, str)
        or not key.strip()
        or not isinstance(item, str)
        or not item.strip()
        for key, item in parsed.items()
    ):
        raise TypeError(f"{name} must be an object of non-empty strings")
    return {key.strip(): item.strip() for key, item in parsed.items()}


def _default_report_path(dataset_path: str | Path) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    stem = Path(dataset_path).stem
    return Path("evaluation/reports") / f"{stem}-{timestamp}.json"


def _json_default(value: object) -> object:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _error_summary(exc: Exception) -> str:
    message = str(exc).replace("\n", " ").strip() or type(exc).__name__
    return f"{type(exc).__name__}: {message[:1000]}"
