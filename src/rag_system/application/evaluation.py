from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import asdict
from datetime import UTC, datetime
from statistics import fmean
from time import perf_counter
from typing import Any, Sequence

from ..domain.evaluation import (
    EvaluationCase,
    EvaluationJudge,
    EvaluationSample,
)
from ..domain.models import AnswerResult, Evidence, SearchEvidenceResult
from .generation import GenerationError, GenerationService
from .retrieval import search_result_to_dict


EVALUATION_SCHEMA_VERSION = "rag-evaluation-v3"


class RAGEvaluator:
    def __init__(
        self,
        generation: GenerationService,
        *,
        judge: EvaluationJudge | None = None,
        concurrency: int = 2,
    ) -> None:
        if concurrency < 1:
            raise ValueError("evaluation concurrency must be positive")
        self._generation = generation
        self._judge = judge
        self._concurrency = concurrency

    async def run(self, cases: Sequence[EvaluationCase]) -> dict[str, Any]:
        if not cases:
            raise ValueError("evaluation dataset cannot be empty")
        started_at = _timestamp()
        semaphore = asyncio.Semaphore(self._concurrency)

        async def evaluate(case: EvaluationCase) -> dict[str, Any]:
            async with semaphore:
                return await self._evaluate_case(case)

        case_results = await asyncio.gather(*(evaluate(case) for case in cases))
        return {
            "schema_version": EVALUATION_SCHEMA_VERSION,
            "started_at": started_at,
            "finished_at": _timestamp(),
            "ragas_enabled": self._judge is not None,
            "summary": _summarize(case_results),
            "cases": case_results,
        }

    async def _evaluate_case(self, case: EvaluationCase) -> dict[str, Any]:
        base = {
            "case": asdict(case),
            "status": "failed",
            "response_status": None,
            "response": None,
            "citations": [],
            "generation": None,
            "retrieval": None,
            "retrieved_contexts": [],
            "retrieved_context_ids": [],
            "metrics": {},
            "metric_reasons": {},
            "metric_skips": {},
            "errors": {},
            "system_latency_ms": None,
            "judge_latency_ms": None,
        }
        system_started = perf_counter()
        try:
            result = await self._generation.answer_question(
                case.user_input,
                case.knowledge_base_id,
                case.top_k,
                explicit_filters=case.explicit_filters,
                context=case.context,
            )
        except Exception as exc:
            base["system_latency_ms"] = _elapsed_ms(system_started)
            base["errors"] = {"generation": _error_summary(exc)}
            if isinstance(exc, GenerationError) and exc.retrieval is not None:
                retrieval = exc.retrieval
                metrics, skips = deterministic_retrieval_metrics(case, retrieval)
                skips.update(
                    {
                        "response_status_accuracy": (
                            "generation failed before response status"
                        ),
                        "citation_precision": "generation failed before citations",
                        "citation_recall": "generation failed before citations",
                    }
                )
                if self._judge is not None:
                    skips.update(
                        {
                            name: "generation failed before judge inputs were complete"
                            for name in self._judge.metric_names
                        }
                    )
                base.update(
                    {
                        "retrieval": search_result_to_dict(retrieval),
                        "retrieved_contexts": [
                            _judge_context(item) for item in retrieval.results
                        ],
                        "retrieved_context_ids": [
                            item.chunk_id for item in retrieval.results
                        ],
                        "metrics": metrics,
                        "metric_skips": skips,
                    }
                )
            return base

        base["system_latency_ms"] = _elapsed_ms(system_started)
        retrieval = result.retrieval
        contexts = tuple(_judge_context(item) for item in retrieval.results)
        context_ids = tuple(item.chunk_id for item in retrieval.results)
        metrics, skips = deterministic_rag_metrics(case, result)
        base.update(
            {
                "status": "ok",
                "response_status": result.status,
                "response": result.answer,
                "citations": [asdict(citation) for citation in result.citations],
                "generation": asdict(result.generation),
                "retrieval": search_result_to_dict(retrieval),
                "retrieved_contexts": list(contexts),
                "retrieved_context_ids": list(context_ids),
                "metrics": metrics,
                "metric_skips": skips,
            }
        )
        if self._judge is None:
            return base
        if not result.answer or not case.reference:
            reason = "metric requires an answered response and reference answer"
            base["metric_skips"].update(
                {name: reason for name in self._judge.metric_names}
            )
            return base

        sample = EvaluationSample(
            user_input=case.user_input,
            retrieved_contexts=contexts,
            reference_contexts=case.reference_contexts,
            retrieved_context_ids=context_ids,
            reference_context_ids=case.reference_context_ids,
            response=result.answer,
            reference=case.reference,
            rubrics=case.rubrics,
            persona_name=case.persona_name,
            query_style=case.query_style,
            query_length=case.query_length,
        )
        judge_started = perf_counter()
        try:
            judged = await self._judge.score(sample)
        except Exception as exc:
            base["judge_latency_ms"] = _elapsed_ms(judge_started)
            base["status"] = "partial"
            base["errors"] = {"ragas": _error_summary(exc)}
            return base

        base["judge_latency_ms"] = _elapsed_ms(judge_started)
        base["metrics"].update(judged.scores)
        base["metric_reasons"] = judged.reasons
        if judged.errors:
            base["status"] = "partial"
            base["errors"] = judged.errors
        return base


def deterministic_rag_metrics(
    case: EvaluationCase, result: AnswerResult
) -> tuple[dict[str, float], dict[str, str]]:
    """Score retrieval, response status, and citations against reviewed IDs."""

    metrics, skips = deterministic_retrieval_metrics(case, result.retrieval)
    expected = set(case.reference_context_ids)
    cited = tuple(dict.fromkeys(item.chunk_id for item in result.citations))
    metrics["response_status_accuracy"] = (
        1.0 if result.status == case.expected_response_status else 0.0
    )

    if expected:
        metrics["citation_recall"] = _rounded(
            len(expected.intersection(cited)) / len(expected)
        )
    else:
        skips["citation_recall"] = "no reference context IDs"

    if cited:
        metrics["citation_precision"] = _rounded(
            sum(identifier in expected for identifier in cited) / len(cited)
        )
    else:
        skips["citation_precision"] = "no cited context IDs"
    return metrics, skips


def deterministic_retrieval_metrics(
    case: EvaluationCase, retrieval: SearchEvidenceResult
) -> tuple[dict[str, float], dict[str, str]]:
    """Score retrieved context IDs even when downstream generation fails."""

    retrieved = tuple(dict.fromkeys(item.chunk_id for item in retrieval.results))
    expected = set(case.reference_context_ids)
    metrics: dict[str, float] = {}
    skips: dict[str, str] = {}

    if retrieved:
        metrics["id_based_context_precision"] = _rounded(
            sum(identifier in expected for identifier in retrieved) / len(retrieved)
        )
    else:
        skips["id_based_context_precision"] = "no retrieved context IDs"

    if expected:
        matched = expected.intersection(retrieved)
        first_relevant = next(
            (
                rank
                for rank, identifier in enumerate(retrieved, 1)
                if identifier in expected
            ),
            None,
        )
        metrics.update(
            {
                "id_based_context_recall": _rounded(len(matched) / len(expected)),
                "hit_rate_at_k": 1.0 if matched else 0.0,
                "mrr": _rounded(1.0 / first_relevant if first_relevant else 0.0),
            }
        )
    else:
        reason = "no reference context IDs"
        for name in ("id_based_context_recall", "hit_rate_at_k", "mrr"):
            skips[name] = reason
    return metrics, skips


def _judge_context(evidence: Evidence) -> str:
    if not evidence.section_path:
        return evidence.snippet
    breadcrumb = " > ".join(evidence.section_path)
    return f"[{breadcrumb}]\n{evidence.snippet}"


def _summarize(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    summary = _aggregate(results)
    tags = sorted({tag for result in results for tag in result["case"].get("tags", ())})
    summary["slices"] = {
        tag: _aggregate(
            [result for result in results if tag in result["case"].get("tags", ())]
        )
        for tag in tags
    }
    return summary


def _aggregate(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    statuses = {"ok": 0, "partial": 0, "failed": 0}
    metric_values: dict[str, list[float]] = {}
    for result in results:
        statuses[result["status"]] += 1
        for name, value in result["metrics"].items():
            metric_values.setdefault(name, []).append(float(value))

    metrics = {
        name: _numeric_summary(values) for name, values in sorted(metric_values.items())
    }
    if statuses["failed"] == len(results):
        status = "failed"
    elif statuses["failed"] or statuses["partial"]:
        status = "partial"
    else:
        status = "ok"
    return {
        "status": status,
        "total_cases": len(results),
        "ok_cases": statuses["ok"],
        "partial_cases": statuses["partial"],
        "failed_cases": statuses["failed"],
        "metrics": metrics,
        "latency_ms": {
            "system": _optional_numeric_summary(
                result["system_latency_ms"] for result in results
            ),
            "judge": _optional_numeric_summary(
                result["judge_latency_ms"] for result in results
            ),
        },
    }


def _optional_numeric_summary(values: Iterable[float | None]) -> dict[str, Any]:
    present = [float(value) for value in values if value is not None]
    if not present:
        return {"count": 0, "mean": None, "min": None, "max": None}
    return _numeric_summary(present)


def _numeric_summary(values: Sequence[float]) -> dict[str, Any]:
    return {
        "count": len(values),
        "mean": _rounded(fmean(values)),
        "min": _rounded(min(values)),
        "max": _rounded(max(values)),
    }


def _timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _elapsed_ms(started: float) -> float:
    return round((perf_counter() - started) * 1000, 3)


def _rounded(value: float) -> float:
    return round(value, 8)


def _error_summary(exc: Exception) -> str:
    return f"{type(exc).__name__}: {str(exc)[:1000]}"
