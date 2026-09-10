from __future__ import annotations

import pytest

from rag_system.application.generation import GenerationError, GenerationService
from rag_system.domain.models import (
    Evidence,
    QueryContext,
    QueryPlan,
    SearchEvidenceResult,
)


def _evidence(rank: int, chunk_id: str = "chunk-1") -> Evidence:
    return Evidence(
        rank=rank,
        chunk_id=chunk_id,
        document_id="doc-1",
        document_revision_id="rev-1",
        title="Apollo migration",
        snippet=f"Evidence {rank}.",
        page_start=rank,
        page_end=rank,
        section_path=("Projects", "Apollo"),
        source_uri="rag://documents/doc-1/revisions/rev-1",
        score=0.9,
        term_score=0.8,
        vector_score=0.7,
    )


def _result(*evidence: Evidence) -> SearchEvidenceResult:
    plan = QueryPlan(
        normalization_version="test-v1",
        raw_query="When did Apollo migrate?",
        resolved_query="When did Apollo migrate?",
        lexical_query="when did apollo migrate",
        semantic_query="When did Apollo migrate?",
    )
    return SearchEvidenceResult(
        status="ok" if evidence else "empty",
        resolved_query=plan.resolved_query,
        query_plan=plan,
        knowledge_base_id="kb-1",
        results=tuple(evidence),
        next_context=QueryContext(
            user_query=plan.raw_query, resolved_query=plan.resolved_query
        ),
        total_candidates=len(evidence),
    )


class FakeRetrieval:
    def __init__(self, result: SearchEvidenceResult) -> None:
        self.result = result
        self.calls: list[tuple] = []

    async def search_evidence(
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


class FakeProvider:
    model_id = "answer-model"

    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    async def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(response, BaseException):
            raise response
        return response


@pytest.mark.asyncio
async def test_answer_question_maps_validated_citations_to_original_evidence() -> None:
    retrieval = FakeRetrieval(_result(_evidence(1), _evidence(2, "chunk-2")))
    provider = FakeProvider(
        {
            "status": "answered",
            "answer": "Apollo migrated in July [1].",
            "citations": [1],
        }
    )
    service = GenerationService(retrieval, provider, prompt_version="test-v2")

    result = await service.answer_question(
        "When did Apollo migrate?",
        "kb-1",
        2,
        explicit_filters={"language": "en"},
        context=(QueryContext(user_query="What is Apollo?"),),
    )

    assert result.status == "answered"
    assert result.answer == "Apollo migrated in July [1]."
    assert result.citations[0].marker == 1
    assert result.citations[0].chunk_id == "chunk-1"
    assert result.citations[0].snippet == "Evidence 1."
    assert result.generation.model == "answer-model"
    assert result.generation.prompt_version == "test-v2"
    assert retrieval.calls[0][0:3] == ("When did Apollo migrate?", "kb-1", 2)
    assert retrieval.calls[0][3] == {"language": "en"}
    assert provider.calls[0]["schema_name"] == "rag_answer"
    assert provider.calls[0]["schema"]["required"] == [
        "status",
        "answer",
        "citations",
    ]
    assert "untrusted data" in provider.calls[0]["user_prompt"]


@pytest.mark.asyncio
async def test_empty_retrieval_abstains_without_calling_generation_provider() -> None:
    retrieval = FakeRetrieval(_result())
    provider = FakeProvider(
        {
            "status": "answered",
            "answer": "This must not be used [1].",
            "citations": [1],
        }
    )
    service = GenerationService(retrieval, provider)

    result = await service.answer_question("Unknown question", "kb-1", 8)

    assert result.status == "insufficient_evidence"
    assert result.answer is None
    assert result.citations == ()
    assert provider.calls == []


@pytest.mark.asyncio
async def test_invalid_model_output_is_retried_once() -> None:
    retrieval = FakeRetrieval(_result(_evidence(1)))
    provider = FakeProvider(
        {
            "status": "answered",
            "answer": "Apollo migrated [2].",
            "citations": [2],
        },
        {
            "status": "answered",
            "answer": "Apollo migrated in July [1].",
            "citations": [1],
        },
    )
    service = GenerationService(retrieval, provider)

    result = await service.answer_question("When?", "kb-1")

    assert result.status == "answered"
    assert len(provider.calls) == 2
    assert "previous response was invalid" in provider.calls[1]["user_prompt"]


@pytest.mark.asyncio
async def test_invalid_model_output_after_retry_is_redacted() -> None:
    retrieval = FakeRetrieval(_result(_evidence(1)))
    provider = FakeProvider(
        {
            "status": "answered",
            "answer": "Apollo migrated [2].",
            "citations": [2],
        }
    )
    service = GenerationService(retrieval, provider)

    with pytest.raises(GenerationError, match="invalid answer") as exc_info:
        await service.answer_question("When?", "kb-1")

    assert len(provider.calls) == 2
    assert "chunk" not in str(exc_info.value)
    assert exc_info.value.retrieval is retrieval.result


@pytest.mark.asyncio
async def test_provider_failure_is_retried_once_and_redacted() -> None:
    retrieval = FakeRetrieval(_result(_evidence(1)))
    provider = FakeProvider(RuntimeError("provider secret response"))
    service = GenerationService(retrieval, provider)

    with pytest.raises(
        GenerationError, match="generation service unavailable"
    ) as exc_info:
        await service.answer_question("When?", "kb-1")

    assert "provider secret" not in str(exc_info.value)
    assert len(provider.calls) == 2
    assert exc_info.value.retrieval is retrieval.result


@pytest.mark.asyncio
async def test_model_can_return_structured_insufficient_evidence() -> None:
    retrieval = FakeRetrieval(_result(_evidence(1)))
    provider = FakeProvider(
        {"status": "insufficient_evidence", "answer": None, "citations": []}
    )
    service = GenerationService(retrieval, provider)

    result = await service.answer_question("Unsupported detail?", "kb-1")

    assert result.status == "insufficient_evidence"
    assert result.answer is None
    assert result.citations == ()


@pytest.mark.parametrize(
    "payload",
    [
        {
            "status": "answered",
            "answer": "Apollo migrated [1].",
            "citations": [],
        },
        {
            "status": "answered",
            "answer": "Apollo migrated [1].",
            "citations": [1, 1],
        },
        {
            "status": "answered",
            "answer": "Apollo migrated [1].",
            "citations": [1],
            "extra": "unsupported",
        },
        {
            "status": "insufficient_evidence",
            "answer": "I guessed anyway.",
            "citations": [],
        },
    ],
)
@pytest.mark.asyncio
async def test_invalid_answer_shapes_are_rejected(payload: dict) -> None:
    service = GenerationService(
        FakeRetrieval(_result(_evidence(1))),
        FakeProvider(payload),
        max_attempts=1,
    )

    with pytest.raises(GenerationError, match="invalid answer"):
        await service.answer_question("When?", "kb-1")
