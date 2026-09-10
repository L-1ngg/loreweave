from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from rag_system.domain.models import QueryContext
from rag_system.domain.query_understanding import (
    EntityAliasMatcher,
    QueryUnderstandingService,
    merge_filters,
    normalize_query,
    parse_time_filters,
)


BASE = datetime(2026, 7, 23, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))


def test_normalization_handles_nfkc_traditional_urls_and_boundaries() -> None:
    result = normalize_query("ＡＰＩ專案https://example.com\x00測試")
    assert result == "api 专案 测试" or result == "api 项目 测试"
    assert "http" not in result


@pytest.mark.parametrize(
    ("query", "field", "start", "end"),
    [
        ("2025年第2季度项目", "source_date", "2025-04-01", "2025-07-01"),
        ("去年导入的文档", "created_at", "2025-01-01", "2026-01-01"),
        ("documents imported last year", "created_at", "2025-01-01", "2026-01-01"),
        ("最近 7 天", "source_date", "2026-07-17", "2026-07-24"),
        ("从 2025年3月以来", "source_date", "2025-03-01", "9999-01-01"),
        ("2025年3月生效", "effective", "2025-03-01", "2025-04-01"),
    ],
)
def test_time_parser_builds_deterministic_ranges(query, field, start, end) -> None:
    filters, spans, ambiguities = parse_time_filters(
        normalize_query(query), relative_base=BASE, timezone=ZoneInfo("Asia/Shanghai")
    )
    assert filters[field]["gte"].startswith(start)
    assert filters[field]["lt"].startswith(end)
    assert spans
    assert ambiguities == []


def test_ambiguous_numeric_date_never_becomes_a_hard_filter() -> None:
    filters, _, ambiguities = parse_time_filters(
        "03/04/2025", relative_base=BASE, timezone=ZoneInfo("Asia/Shanghai")
    )
    assert filters == {}
    assert "ambiguous date" in ambiguities[0]


@pytest.mark.parametrize("query", ["2025-13 项目", "before 2025-02-31"])
def test_invalid_absolute_date_never_becomes_a_hard_filter(query: str) -> None:
    filters, _, ambiguities = parse_time_filters(
        query, relative_base=BASE, timezone=ZoneInfo("Asia/Shanghai")
    )

    assert filters == {}
    assert any("could not be parsed" in item for item in ambiguities)


def test_entity_matcher_uses_longest_alias_and_does_not_guess_ambiguity() -> None:
    matcher = EntityAliasMatcher(
        [
            {
                "alias": "Apollo",
                "entity_ref": "project:apollo",
                "entity_type": "project",
                "canonical_name": "Apollo",
            },
            {
                "alias": "Apollo Program",
                "entity_ref": "program:apollo",
                "entity_type": "program",
                "canonical_name": "Apollo Program",
            },
            {
                "alias": "Mercury",
                "entity_ref": "project:mercury",
                "entity_type": "project",
                "canonical_name": "Mercury",
            },
            {
                "alias": "Mercury",
                "entity_ref": "person:mercury",
                "entity_type": "person",
                "canonical_name": "Mercury",
            },
        ]
    )

    hits, ambiguities = matcher.match("Apollo Program and Mercury")

    assert [hit.entity_ref for hit in hits] == ["program:apollo"]
    assert len(ambiguities) == 1


def test_explicit_and_inferred_filter_conflict_is_empty_and_explainable() -> None:
    filters, conflicts = merge_filters(
        {"language": {"any": ["en"]}},
        {"language": {"any": ["zh"]}},
    )
    assert filters["__empty__"] is True
    assert conflicts == ["explicit and inferred language filters conflict"]


class AliasProvider:
    async def list_entity_aliases(self, knowledge_base_id):
        return [
            {
                "alias": "Apollo",
                "entity_ref": "project:apollo",
                "entity_type": "project",
                "canonical_name": "Apollo",
            }
        ]


class MultiAliasProvider:
    async def list_entity_aliases(self, knowledge_base_id):
        return [
            {
                "alias": "Apollo",
                "entity_ref": "project:apollo",
                "entity_type": "project",
                "canonical_name": "Apollo",
            },
            {
                "alias": "Mercury",
                "entity_ref": "project:mercury",
                "entity_type": "project",
                "canonical_name": "Mercury",
            },
            {
                "alias": "Mercury",
                "entity_ref": "person:mercury",
                "entity_type": "person",
                "canonical_name": "Mercury",
            },
        ]


class ResolverChat:
    model_id = "chat"

    def __init__(self, payload):
        self.payload = payload

    async def complete_json(self, **kwargs):
        return self.payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "expected"),
    [
        (
            "Apollo and project Mercury",
            {"all": ["project:apollo", "project:mercury"]},
        ),
        (
            "Apollo or project Mercury",
            {"any": ["project:apollo", "project:mercury"]},
        ),
        ("without Apollo", {"none": ["project:apollo"]}),
        ("person Mercury", {"all": ["person:mercury"]}),
    ],
)
async def test_entity_filters_support_boolean_conditions_and_type_hints(
    query: str, expected: dict[str, list[str]]
) -> None:
    service = QueryUnderstandingService(
        alias_provider=MultiAliasProvider(), relative_base=BASE
    )

    plan, _ = await service.build_plan(query, "kb-1")

    assert plan.filters["entity_refs"] == expected
    assert plan.ambiguities == ()


@pytest.mark.asyncio
async def test_reference_resolution_allows_only_context_replacement() -> None:
    chat = ResolverChat(
        {
            "resolved_query": "project:apollo 去年有什么进展",
            "confidence": 0.95,
            "replacements": [
                {"original": "它", "replacement": "project:apollo", "kind": "entity"}
            ],
        }
    )
    service = QueryUnderstandingService(
        alias_provider=AliasProvider(), chat_provider=chat, relative_base=BASE
    )

    plan, next_context = await service.build_plan(
        "它去年有什么进展",
        "kb-1",
        context=(
            QueryContext(user_query="Apollo 是什么", entity_refs=("project:apollo",)),
        ),
    )

    assert plan.resolved_query == "project:apollo 去年有什么进展"
    assert plan.replacements[0].replacement == "project:apollo"
    assert plan.filters["source_date"]["gte"].startswith("2025-01-01")
    assert next_context.user_query == "它去年有什么进展"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "original", "replacement", "kind"),
    [
        ("该项目有什么进展", "该项目", "project:apollo", "entity"),
        ("他负责什么", "他", "person:alex", "entity"),
        ("前者何时完成", "前者", "project:apollo", "entity"),
        ("那一年发生了什么", "那一年", "2025年第2季度", "time"),
    ],
)
async def test_reference_resolution_supports_bounded_chinese_markers(
    query: str, original: str, replacement: str, kind: str
) -> None:
    resolved = query.replace(original, replacement, 1)
    chat = ResolverChat(
        {
            "resolved_query": resolved,
            "confidence": 0.95,
            "replacements": [
                {"original": original, "replacement": replacement, "kind": kind}
            ],
        }
    )
    context = QueryContext(
        user_query="previous",
        entity_refs=(replacement,) if kind == "entity" else (),
        time_expressions=(replacement,) if kind == "time" else (),
    )
    service = QueryUnderstandingService(chat_provider=chat, relative_base=BASE)

    plan, _ = await service.build_plan(query, "kb-1", context=(context,))

    assert plan.resolved_query == resolved
    assert plan.replacements[0].replacement == replacement
    assert not any("reference resolution rejected" in item for item in plan.ambiguities)


@pytest.mark.asyncio
async def test_reference_expansion_is_rejected_and_original_query_is_used() -> None:
    chat = ResolverChat(
        {
            "resolved_query": "project:apollo 去年有什么安全风险和预算",
            "confidence": 0.99,
            "replacements": [
                {"original": "它", "replacement": "project:apollo", "kind": "entity"}
            ],
        }
    )
    service = QueryUnderstandingService(chat_provider=chat, relative_base=BASE)
    plan, _ = await service.build_plan(
        "它去年有什么进展",
        "kb-1",
        context=(QueryContext(user_query="Apollo", entity_refs=("project:apollo",)),),
    )
    assert plan.resolved_query == "它去年有什么进展"
    assert "reference resolution rejected" in plan.ambiguities[0]


@pytest.mark.asyncio
async def test_reference_resolver_rejects_unknown_replacement_kind() -> None:
    chat = ResolverChat(
        {
            "resolved_query": "project:apollo 去年有什么进展",
            "confidence": 0.99,
            "replacements": [
                {
                    "original": "它",
                    "replacement": "project:apollo",
                    "kind": "keyword_expansion",
                }
            ],
        }
    )
    service = QueryUnderstandingService(chat_provider=chat, relative_base=BASE)

    plan, _ = await service.build_plan(
        "它去年有什么进展",
        "kb-1",
        context=(QueryContext(user_query="Apollo", entity_refs=("project:apollo",)),),
    )

    assert plan.resolved_query == "它去年有什么进展"
    assert "reference resolution rejected" in plan.ambiguities[0]
