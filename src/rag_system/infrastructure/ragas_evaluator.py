from __future__ import annotations

import asyncio
import math
from typing import Any

from ..domain.evaluation import EvaluationSample, JudgeResult
from .config import Settings


class RagasJudge:
    _METRIC_NAMES = (
        "context_precision",
        "context_recall",
        "faithfulness",
        "factual_correctness",
        "answer_relevancy",
    )

    def __init__(
        self,
        *,
        client: Any,
        embedding_client: Any | None,
        context_precision: Any,
        context_recall: Any,
        faithfulness: Any,
        factual_correctness: Any,
        answer_relevancy: Any,
    ) -> None:
        self._clients = (client, embedding_client)
        self._context_precision = context_precision
        self._context_recall = context_recall
        self._faithfulness = faithfulness
        self._factual_correctness = factual_correctness
        self._answer_relevancy = answer_relevancy

    @property
    def metric_names(self) -> tuple[str, ...]:
        return self._METRIC_NAMES

    @classmethod
    def from_settings(cls, settings: Settings) -> "RagasJudge":
        settings.validate_evaluation().validate_embedding()
        evaluation = settings.evaluation
        embedding = settings.embedding
        try:
            from openai import AsyncOpenAI
            from ragas.embeddings.base import embedding_factory
            from ragas.llms import llm_factory
            from ragas.metrics.collections import (
                AnswerRelevancy,
                ContextPrecision,
                ContextRecall,
                FactualCorrectness,
                Faithfulness,
            )
        except ImportError as exc:
            raise RuntimeError(
                "Ragas evaluation dependencies are missing; run `uv sync --extra eval`"
            ) from exc

        client = AsyncOpenAI(
            api_key=evaluation.api_key.get_secret_value(),
            base_url=evaluation.base_url,
            timeout=evaluation.timeout_seconds,
        )
        embedding_client = AsyncOpenAI(
            api_key=embedding.api_key.get_secret_value(),
            base_url=embedding.base_url,
            timeout=evaluation.timeout_seconds,
        )
        llm = llm_factory(
            evaluation.model,
            provider="openai",
            client=client,
            temperature=0.0,
        )
        evaluator_embeddings = embedding_factory(
            "openai",
            model=embedding.model,
            client=embedding_client,
            interface="modern",
        )
        return cls(
            client=client,
            embedding_client=embedding_client,
            context_precision=ContextPrecision(llm=llm),
            context_recall=ContextRecall(llm=llm),
            faithfulness=Faithfulness(llm=llm),
            factual_correctness=FactualCorrectness(llm=llm, mode="f1"),
            answer_relevancy=AnswerRelevancy(
                llm=llm,
                embeddings=evaluator_embeddings,
            ),
        )

    async def score(self, sample: EvaluationSample) -> JudgeResult:
        try:
            from ragas import SingleTurnSample
        except ImportError as exc:  # pragma: no cover - guarded by from_settings
            raise RuntimeError("Ragas evaluation dependencies are missing") from exc

        ragas_sample = SingleTurnSample(
            user_input=sample.user_input,
            retrieved_contexts=list(sample.retrieved_contexts),
            reference_contexts=list(sample.reference_contexts),
            retrieved_context_ids=list(sample.retrieved_context_ids),
            reference_context_ids=list(sample.reference_context_ids),
            response=sample.response,
            reference=sample.reference,
            rubrics=sample.rubrics or None,
            persona_name=sample.persona_name or None,
            query_style=sample.query_style or None,
            query_length=sample.query_length or None,
        )
        calls = {
            "context_precision": self._context_precision.ascore(
                user_input=ragas_sample.user_input,
                reference=ragas_sample.reference,
                retrieved_contexts=ragas_sample.retrieved_contexts,
            ),
            "context_recall": self._context_recall.ascore(
                user_input=ragas_sample.user_input,
                reference=ragas_sample.reference,
                retrieved_contexts=ragas_sample.retrieved_contexts,
            ),
            "faithfulness": self._faithfulness.ascore(
                user_input=ragas_sample.user_input,
                response=ragas_sample.response,
                retrieved_contexts=ragas_sample.retrieved_contexts,
            ),
            "factual_correctness": self._factual_correctness.ascore(
                response=ragas_sample.response,
                reference=ragas_sample.reference,
            ),
            "answer_relevancy": self._answer_relevancy.ascore(
                user_input=ragas_sample.user_input,
                response=ragas_sample.response,
            ),
        }
        results = await asyncio.gather(*calls.values(), return_exceptions=True)
        scores: dict[str, float] = {}
        reasons: dict[str, str] = {}
        errors: dict[str, str] = {}
        for name, result in zip(calls, results, strict=True):
            if isinstance(result, BaseException):
                if not isinstance(result, Exception):
                    raise result
                errors[name] = _error_summary(result)
                continue
            try:
                value = float(result.value)
            except (AttributeError, TypeError, ValueError) as exc:
                errors[name] = f"invalid Ragas score: {type(exc).__name__}"
                continue
            if not math.isfinite(value):
                errors[name] = "Ragas returned a non-finite score"
                continue
            scores[name] = round(min(1.0, max(0.0, value)), 8)
            reason = getattr(result, "reason", None)
            if reason:
                reasons[name] = str(reason)
        return JudgeResult(scores=scores, reasons=reasons, errors=errors)

    async def close(self) -> None:
        seen: set[int] = set()
        for client in self._clients:
            if client is None or id(client) in seen:
                continue
            seen.add(id(client))
            await client.close()


def _error_summary(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {str(exc)[:1000]}"
