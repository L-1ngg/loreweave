from __future__ import annotations

from dataclasses import replace
import json

import pytest

from rag_system.application.evaluation import RAGEvaluator, deterministic_rag_metrics
from rag_system.application.generation import GenerationError
from rag_system.application.worker import RebuildReport
from rag_system.domain.evaluation import EvaluationCase, EvaluationSample, JudgeResult
from rag_system.domain.models import (
    AnswerCitation,
    AnswerResult,
    Evidence,
    GenerationMetadata,
    QueryContext,
    QueryPlan,
    SearchEvidenceResult,
)
from rag_system.infrastructure.config import Settings
from rag_system.infrastructure.ragas_evaluator import RagasJudge
from rag_system.interfaces.cli import _build_parser
from rag_system.interfaces.evaluation import load_evaluation_dataset, run_evaluation


def _evidence(rank: int, chunk_id: str, document_id: str) -> Evidence:
    return Evidence(
        rank=rank,
        chunk_id=chunk_id,
        document_id=document_id,
        document_revision_id=f"rev-{document_id}",
        title="Apollo migration",
        snippet=f"Evidence from {chunk_id}",
        page_start=1,
        page_end=1,
        section_path=("Projects", "Apollo"),
        source_uri="s3://bucket/source.pdf",
        score=0.8,
        term_score=0.7,
        vector_score=0.9,
    )


def _search_result(*evidence: Evidence) -> SearchEvidenceResult:
    plan = QueryPlan(
        normalization_version="test-v1",
        raw_query="When did Apollo migrate?",
        resolved_query="When did Apollo migrate?",
        lexical_query="when did apollo migrate",
        semantic_query="When did Apollo migrate?",
    )
    return SearchEvidenceResult(
        status="ok",
        resolved_query=plan.resolved_query,
        query_plan=plan,
        knowledge_base_id="kb-1",
        results=tuple(evidence),
        next_context=QueryContext(user_query=plan.raw_query),
        total_candidates=len(evidence),
    )


def _citation(evidence: Evidence) -> AnswerCitation:
    return AnswerCitation(
        marker=evidence.rank,
        rank=evidence.rank,
        chunk_id=evidence.chunk_id,
        document_id=evidence.document_id,
        document_revision_id=evidence.document_revision_id,
        title=evidence.title,
        snippet=evidence.snippet,
        page_start=evidence.page_start,
        page_end=evidence.page_end,
        section_path=evidence.section_path,
        source_uri=evidence.source_uri,
        score=evidence.score,
        term_score=evidence.term_score,
        vector_score=evidence.vector_score,
    )


def _answer_result(
    *evidence: Evidence,
    status: str = "answered",
    cited_chunk_ids: tuple[str, ...] = ("chunk-hit",),
) -> AnswerResult:
    citations = tuple(
        _citation(item) for item in evidence if item.chunk_id in cited_chunk_ids
    )
    return AnswerResult(
        status=status,
        answer="Apollo migrated in July [2]" if status == "answered" else None,
        citations=citations if status == "answered" else (),
        retrieval=_search_result(*evidence),
        generation=GenerationMetadata(model="answer-model", prompt_version="v1"),
    )


class FakeGeneration:
    def __init__(self, result: AnswerResult) -> None:
        self.result = result
        self.calls = []

    async def answer_question(
        self,
        query,
        knowledge_base_id,
        top_k,
        *,
        explicit_filters,
        context,
    ):
        self.calls.append(
            (query, knowledge_base_id, top_k, explicit_filters, tuple(context))
        )
        return self.result


class FakeJudge:
    metric_names = ("context_precision", "context_recall")

    def __init__(self) -> None:
        self.samples: list[EvaluationSample] = []

    async def score(self, sample: EvaluationSample) -> JudgeResult:
        self.samples.append(sample)
        assert sample.user_input == "When did Apollo migrate?"
        assert sample.reference == "Apollo migrated in July."
        assert sample.retrieved_contexts[0].startswith("[Projects > Apollo]\n")
        return JudgeResult(
            scores={"context_precision": 0.75},
            reasons={"context_precision": "One context is useful."},
            errors={"context_recall": "judge timeout"},
        )


class FakeIndexManager:
    def __init__(self, *, verified: bool) -> None:
        self.verified = verified
        self.calls = []

    async def verify(self, index, knowledge_base_id):
        self.calls.append((index, knowledge_base_id))
        return RebuildReport(
            index=index,
            knowledge_base_id=knowledge_base_id,
            revision_count=1,
            expected_chunks=1,
            indexed_chunks=1 if self.verified else 0,
            expected_checksum_count=1,
            indexed_checksum_count=1 if self.verified else 0,
            matched_checksums=1 if self.verified else 0,
            missing_checksums=0 if self.verified else 1,
            unexpected_checksums=0,
            projection_coverage=1.0 if self.verified else 0.0,
            verified=self.verified,
        )


def _answered_case(**kwargs) -> EvaluationCase:
    values = {
        "case_id": "apollo-1",
        "user_input": "When did Apollo migrate?",
        "reference": "Apollo migrated in July.",
        "reference_context_ids": ("chunk-hit", "chunk-missing"),
    }
    values.update(kwargs)
    return EvaluationCase(**values)


def test_deterministic_metrics_use_ragas_context_ids_and_citations() -> None:
    case = _answered_case()
    result = _answer_result(
        _evidence(1, "chunk-noise", "doc-noise"),
        _evidence(2, "chunk-hit", "doc-hit"),
        _evidence(3, "chunk-other", "doc-other"),
    )

    metrics, skips = deterministic_rag_metrics(case, result)

    assert metrics == {
        "response_status_accuracy": 1.0,
        "id_based_context_precision": 0.33333333,
        "id_based_context_recall": 0.5,
        "hit_rate_at_k": 1.0,
        "mrr": 0.5,
        "citation_recall": 0.5,
        "citation_precision": 1.0,
    }
    assert skips == {}


@pytest.mark.asyncio
async def test_no_answer_case_scores_status_and_skips_inapplicable_metrics() -> None:
    result = _answer_result(status="insufficient_evidence", cited_chunk_ids=())
    case = EvaluationCase(
        case_id="unknown",
        user_input="Unknown?",
        reference="",
        reference_context_ids=(),
        expected_response_status="insufficient_evidence",
        tags=("unanswerable",),
    )
    judge = FakeJudge()

    report = await RAGEvaluator(FakeGeneration(result), judge=judge, concurrency=1).run(
        [case]
    )

    evaluated = report["cases"][0]
    assert evaluated["status"] == "ok"
    assert evaluated["metrics"] == {"response_status_accuracy": 1.0}
    assert set(judge.metric_names).issubset(evaluated["metric_skips"])
    assert evaluated["metric_skips"]["id_based_context_recall"] == (
        "no reference context IDs"
    )
    assert judge.samples == []


@pytest.mark.asyncio
async def test_generation_failure_preserves_retrieval_diagnostics() -> None:
    retrieval = _search_result(
        _evidence(1, "chunk-noise", "doc-noise"),
        _evidence(2, "chunk-hit", "doc-hit"),
    )

    class FailedGeneration:
        async def answer_question(self, *args, **kwargs):
            raise GenerationError("invalid answer", retrieval=retrieval)

    judge = FakeJudge()
    report = await RAGEvaluator(FailedGeneration(), judge=judge, concurrency=1).run(
        [_answered_case(reference_context_ids=("chunk-hit",))]
    )

    evaluated = report["cases"][0]
    assert evaluated["status"] == "failed"
    assert evaluated["retrieved_context_ids"] == ["chunk-noise", "chunk-hit"]
    assert evaluated["retrieval"]["query_plan"]["normalization_version"] == "test-v1"
    assert evaluated["metrics"] == {
        "id_based_context_precision": 0.5,
        "id_based_context_recall": 1.0,
        "hit_rate_at_k": 1.0,
        "mrr": 0.5,
    }
    assert evaluated["metric_skips"]["response_status_accuracy"].startswith(
        "generation failed"
    )
    assert evaluated["metric_skips"]["context_precision"].startswith(
        "generation failed"
    )
    assert judge.samples == []


@pytest.mark.asyncio
async def test_runner_preserves_outputs_when_one_ragas_metric_fails() -> None:
    result = _answer_result(
        _evidence(1, "chunk-hit", "doc-hit"),
        cited_chunk_ids=("chunk-hit",),
    )
    generation = FakeGeneration(result)
    case = _answered_case(
        reference_context_ids=("chunk-hit",),
        knowledge_base_id="kb-1",
        explicit_filters={"language": "en"},
        tags=("direct",),
    )
    judge = FakeJudge()

    report = await RAGEvaluator(generation, judge=judge, concurrency=1).run([case])

    evaluated = report["cases"][0]
    assert report["summary"]["status"] == "partial"
    assert report["summary"]["slices"]["direct"]["total_cases"] == 1
    assert evaluated["status"] == "partial"
    assert evaluated["metrics"]["id_based_context_recall"] == 1.0
    assert evaluated["metrics"]["context_precision"] == 0.75
    assert evaluated["errors"] == {"context_recall": "judge timeout"}
    assert evaluated["generation"]["model"] == "answer-model"
    assert evaluated["retrieval"]["query_plan"]["normalization_version"] == "test-v1"
    assert evaluated["citations"][0]["chunk_id"] == "chunk-hit"
    assert generation.calls[0][3] == {"language": "en"}
    assert judge.samples[0].retrieved_context_ids == ("chunk-hit",)


def test_dataset_loader_is_strict_and_parses_ragas_fields(tmp_path) -> None:
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text(
        json.dumps(
            {
                "case_id": "apollo-1",
                "user_input": "它何时迁移？",
                "reference": "Apollo 在 7 月迁移。",
                "reference_contexts": ["Apollo 在 7 月迁移。"],
                "reference_context_ids": ["chunk-apollo", "chunk-apollo"],
                "knowledge_base_id": "kb-1",
                "context": [
                    {
                        "user_query": "Apollo 项目是什么？",
                        "resolved_query": "Apollo 项目是什么？",
                        "entity_refs": ["project:apollo"],
                    }
                ],
                "rubrics": {"accuracy": "Must state July."},
                "tags": ["zh", "multi-turn"],
                "persona_name": "project manager",
                "query_style": "casual",
                "query_length": "short",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    cases = load_evaluation_dataset(dataset)

    assert cases[0].reference_context_ids == ("chunk-apollo",)
    assert cases[0].reference_contexts == ("Apollo 在 7 月迁移。",)
    assert cases[0].context[0].entity_refs == ("project:apollo",)
    assert cases[0].rubrics == {"accuracy": "Must state July."}
    assert cases[0].persona_name == "project manager"

    dataset.write_text(
        '{"case_id":"bad","user_input":"q","reference":"a",'
        '"reference_context_ids":["c"],"typo":true}\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="unknown fields: typo"):
        load_evaluation_dataset(dataset)


def test_dataset_loader_validates_answerable_and_unanswerable_cases(tmp_path) -> None:
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text(
        '{"case_id":"missing","user_input":"q","reference_context_ids":["c"]}\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="reference is required"):
        load_evaluation_dataset(dataset)

    dataset.write_text(
        '{"case_id":"missing","user_input":"q","reference":"a"}\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="reference_context_ids are required"):
        load_evaluation_dataset(dataset)

    dataset.write_text(
        '{"case_id":"bad","user_input":"q","reference":"a",'
        '"expected_response_status":"insufficient_evidence"}\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="must not define reference"):
        load_evaluation_dataset(dataset)

    dataset.write_text(
        '{"case_id":"unknown","user_input":"q",'
        '"expected_response_status":"insufficient_evidence"}\n',
        encoding="utf-8",
    )
    case = load_evaluation_dataset(dataset)[0]
    assert case.expected_response_status == "insufficient_evidence"


@pytest.mark.asyncio
async def test_run_evaluation_writes_full_end_to_end_report(tmp_path) -> None:
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text(
        '{"case_id":"apollo","user_input":"When?",'
        '"reference":"July","reference_context_ids":["chunk-hit"],'
        '"tags":["direct"]}\n',
        encoding="utf-8",
    )
    output = tmp_path / "report.json"
    generation = FakeGeneration(
        _answer_result(
            _evidence(1, "chunk-hit", "doc-hit"),
            cited_chunk_ids=("chunk-hit",),
        )
    )
    index_manager = FakeIndexManager(verified=True)

    result = await run_evaluation(
        dataset_path=dataset,
        output_path=output,
        experiment_name="baseline-v1",
        use_ragas=False,
        settings=Settings(
            evaluation=replace(Settings().evaluation, concurrency=1),
        ),
        generation=generation,
        index_manager=index_manager,
        index_name="rag-chunks",
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert result["status"] == "ok"
    assert result["experiment_name"] == "baseline-v1"
    assert persisted["schema_version"] == "rag-evaluation-v3"
    assert len(persisted["dataset"]["sha256"]) == 64
    assert persisted["index_verification"]["status"] == "passed"
    assert persisted["summary"]["index_verification_status"] == "passed"
    assert persisted["profiles"]["indexing"]["id"] == "default-v1"
    assert len(persisted["profiles"]["retrieval"]["fingerprint"]) == 64
    assert persisted["cases"][0]["retrieved_context_ids"] == ["chunk-hit"]
    assert persisted["cases"][0]["response"] == "Apollo migrated in July [2]"
    assert persisted["cases"][0]["metrics"]["citation_precision"] == 1.0
    assert persisted["summary"]["slices"]["direct"]["total_cases"] == 1
    assert index_manager.calls == [("rag-chunks", "default")]


@pytest.mark.asyncio
async def test_failed_index_audit_marks_report_partial_but_keeps_scores(
    tmp_path,
) -> None:
    dataset = tmp_path / "cases.jsonl"
    dataset.write_text(
        '{"case_id":"apollo","user_input":"When?",'
        '"reference":"July","reference_context_ids":["chunk-hit"]}\n',
        encoding="utf-8",
    )
    output = tmp_path / "report.json"

    result = await run_evaluation(
        dataset_path=dataset,
        output_path=output,
        experiment_name=None,
        use_ragas=False,
        settings=Settings(
            evaluation=replace(Settings().evaluation, concurrency=1),
        ),
        generation=FakeGeneration(
            _answer_result(
                _evidence(1, "chunk-hit", "doc-hit"),
                cited_chunk_ids=("chunk-hit",),
            )
        ),
        index_manager=FakeIndexManager(verified=False),
        index_name="rag-chunks",
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert result["status"] == "partial"
    assert persisted["summary"]["status"] == "partial"
    assert persisted["index_verification"]["status"] == "failed"
    assert persisted["cases"][0]["metrics"]["id_based_context_recall"] == 1.0


@pytest.mark.asyncio
async def test_ragas_judge_preserves_per_metric_failure() -> None:
    pytest.importorskip("ragas")

    class Client:
        closed = False

        async def close(self):
            self.closed = True

    class MetricResult:
        value = 0.625
        reason = "relevant"

    class SuccessfulMetric:
        def __init__(self):
            self.calls = []

        async def ascore(self, **kwargs):
            self.calls.append(kwargs)
            return MetricResult()

    class FailedMetric:
        async def ascore(self, **kwargs):
            raise TimeoutError("timed out")

    client = Client()
    embedding_client = Client()
    context_precision = SuccessfulMetric()
    judge = RagasJudge(
        client=client,
        embedding_client=embedding_client,
        context_precision=context_precision,
        context_recall=FailedMetric(),
        faithfulness=SuccessfulMetric(),
        factual_correctness=SuccessfulMetric(),
        answer_relevancy=SuccessfulMetric(),
    )
    sample = EvaluationSample(
        user_input="q",
        retrieved_contexts=("c",),
        reference_contexts=("gold context",),
        retrieved_context_ids=("c1",),
        reference_context_ids=("c1",),
        response="a [1]",
        reference="a",
        rubrics={"accuracy": "must be correct"},
    )

    result = await judge.score(sample)
    await judge.close()

    assert result.scores == {
        "context_precision": 0.625,
        "faithfulness": 0.625,
        "factual_correctness": 0.625,
        "answer_relevancy": 0.625,
    }
    assert result.reasons["faithfulness"] == "relevant"
    assert result.errors["context_recall"].startswith("TimeoutError:")
    assert context_precision.calls[0]["reference"] == "a"
    assert client.closed is True
    assert embedding_client.closed is True


def test_cli_exposes_ragas_experiment_options() -> None:
    args = _build_parser().parse_args(
        [
            "eval",
            "run",
            "cases.jsonl",
            "--output",
            "report.json",
            "--experiment-name",
            "candidate-v2",
            "--ragas",
            "--verify-index",
        ]
    )

    assert args.command == "eval"
    assert args.eval_command == "run"
    assert args.experiment_name == "candidate-v2"
    assert args.ragas is True
    assert args.verify_index is True


def test_cli_exposes_grounded_answer_command() -> None:
    args = _build_parser().parse_args(
        [
            "answer",
            "When did Apollo migrate?",
            "--knowledge-base",
            "kb-1",
            "--top-k",
            "4",
            "--filters-json",
            '{"language":"en"}',
            "--context-json",
            "[]",
        ]
    )

    assert args.command == "answer"
    assert args.query == "When did Apollo migrate?"
    assert args.knowledge_base == "kb-1"
    assert args.top_k == 4
    assert args.filters_json == '{"language":"en"}'
