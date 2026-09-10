from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .models import QueryContext


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    user_input: str
    reference: str
    reference_context_ids: tuple[str, ...]
    expected_response_status: str = "answered"
    knowledge_base_id: str = "default"
    top_k: int = 8
    explicit_filters: dict[str, Any] = field(default_factory=dict)
    context: tuple[QueryContext, ...] = ()
    reference_contexts: tuple[str, ...] = ()
    rubrics: dict[str, str] = field(default_factory=dict)
    tags: tuple[str, ...] = ()
    persona_name: str = ""
    query_style: str = ""
    query_length: str = ""


@dataclass(frozen=True)
class EvaluationSample:
    user_input: str
    retrieved_contexts: tuple[str, ...]
    reference_contexts: tuple[str, ...]
    retrieved_context_ids: tuple[str, ...]
    reference_context_ids: tuple[str, ...]
    response: str
    reference: str
    rubrics: dict[str, str] = field(default_factory=dict)
    persona_name: str = ""
    query_style: str = ""
    query_length: str = ""


@dataclass(frozen=True)
class JudgeResult:
    scores: dict[str, float] = field(default_factory=dict)
    reasons: dict[str, str] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)


class EvaluationJudge(Protocol):
    @property
    def metric_names(self) -> tuple[str, ...]: ...

    async def score(self, sample: EvaluationSample) -> JudgeResult: ...
