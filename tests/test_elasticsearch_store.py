from __future__ import annotations

from datetime import UTC, datetime

import pytest

from rag_system.infrastructure.elasticsearch_store import (
    ElasticsearchRepository,
    _filters_to_es,
)
from rag_system.domain.models import Chunk, EnrichmentProvenance, EnrichmentStatus
from rag_system.processing.chunking import CHUNKING_VERSION


class FakeIndicesClient:
    def __init__(self) -> None:
        self.existing: set[str] = set()
        self.aliases: dict[str, set[str]] = {}
        self.mappings: dict[str, dict] = {}
        self.create_calls: list[dict] = []
        self.alias_calls: list[dict] = []

    async def exists(self, *, index: str) -> bool:
        return index in self.existing

    async def exists_alias(self, *, name: str) -> bool:
        return bool(self.aliases.get(name))

    async def create(self, **kwargs):
        self.create_calls.append(kwargs)
        index = kwargs["index"]
        self.existing.add(index)
        self.mappings[index] = {"mappings": kwargs["mappings"]}
        for alias in kwargs.get("aliases", {}):
            self.aliases.setdefault(alias, set()).add(index)
        return {"acknowledged": True}

    async def put_alias(self, **kwargs):
        self.alias_calls.append(kwargs)
        self.aliases.setdefault(kwargs["name"], set()).add(kwargs["index"])

    async def get_mapping(self, *, index: str):
        indices = self.aliases.get(index, {index})
        return {name: self.mappings[name] for name in indices if name in self.mappings}

    async def get_alias(self, *, name: str):
        return {
            index: {"aliases": {name: {}}} for index in self.aliases.get(name, set())
        }

    async def update_aliases(self, *, actions):
        for action in actions:
            if "remove" in action:
                value = action["remove"]
                self.aliases.get(value["alias"], set()).discard(value["index"])
            if "add" in action:
                value = action["add"]
                self.aliases.setdefault(value["alias"], set()).add(value["index"])


class FakeElasticsearchClient:
    def __init__(self) -> None:
        self.indices = FakeIndicesClient()
        self.search_calls: list[dict] = []
        self.search_responses: list[dict] = []
        self.get_response: dict | Exception = {}
        self.delete_by_query_calls: list[dict] = []

    async def search(self, **kwargs):
        self.search_calls.append(kwargs)
        return (
            self.search_responses.pop(0)
            if self.search_responses
            else {"hits": {"hits": []}}
        )

    async def get(self, **kwargs):
        if isinstance(self.get_response, Exception):
            raise self.get_response
        return self.get_response

    async def delete_by_query(self, **kwargs):
        self.delete_by_query_calls.append(kwargs)
        return {"deleted": 0}


def _chunk() -> Chunk:
    return Chunk(
        chunk_id="chunk-1",
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        title="Apollo Notes",
        content="Apollo migrated in July.",
        content_with_weight="Apollo migrated in July.",
        section_path=("Migration",),
        page_start=1,
        page_end=1,
        block_ids=("block-1",),
        asset_refs=(),
        source_object_key="raw/source",
        embedding_profile_id="profile-1",
        chunking_version=CHUNKING_VERSION,
        important_kwd=("Apollo migration",),
        important_tks="apollo migration",
        question_kwd=("When did Apollo migrate?",),
        question_tks="when did apollo migrate",
        title_tks="apollo notes",
        title_sm_tks="apollo notes",
        content_ltks="apollo migrated july",
        content_sm_ltks="apollo migrated in july",
        enrichment=EnrichmentProvenance(status=EnrichmentStatus.SUCCEEDED),
        source_type="pdf",
        language="en",
        tags=("approved",),
        entity_refs=("project:apollo",),
        content_vector=(0.1, 0.2, 0.3),
        checksum="abc",
        metadata={"chunk_ordinal": 1},
        created_at=datetime(2026, 7, 23, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_ensure_index_creates_only_v2_projection_with_fixed_boosts() -> None:
    client = FakeElasticsearchClient()
    repository = ElasticsearchRepository(
        client=client,
        embedding_profile_id="profile-1",
        vector_dimensions=3,
    )

    await repository.ensure_index()

    assert [call["index"] for call in client.indices.create_calls] == ["rag-chunks-v2"]
    create = client.indices.create_calls[0]
    assert create["aliases"] == {"rag-chunks": {}}
    assert create["mappings"]["dynamic"] == "strict"
    assert create["mappings"]["_meta"]["lexical_boosts"] == {
        "important_kwd": 30,
        "important_tks": 20,
        "question_tks": 20,
        "title_tks": 10,
        "title_sm_tks": 5,
        "content_ltks": 2,
        "content_sm_ltks": 1,
    }
    properties = create["mappings"]["properties"]
    for field in (
        "important_kwd",
        "important_tks",
        "question_tks",
        "title_tks",
        "title_sm_tks",
        "content_ltks",
        "content_sm_ltks",
    ):
        assert field in properties
    assert properties["important_kwd"]["normalizer"] == "rag_keyword_lower"
    assert properties["content_with_weight"]["index"] is False


@pytest.mark.asyncio
async def test_delete_revisions_uses_one_idempotent_delete_by_query() -> None:
    client = FakeElasticsearchClient()
    repository = ElasticsearchRepository(
        client=client,
        embedding_profile_id="profile-1",
        vector_dimensions=3,
    )

    await repository.delete_revisions(["rev-1", "rev-2", "rev-1"], refresh=True)
    await repository.delete_revisions([])

    assert client.delete_by_query_calls == [
        {
            "index": "rag-chunks",
            "query": {"terms": {"document_revision_id": ["rev-1", "rev-2"]}},
            "refresh": True,
            "conflicts": "proceed",
        }
    ]


@pytest.mark.asyncio
async def test_dual_recall_and_second_pass_vector_queries_share_filters() -> None:
    client = FakeElasticsearchClient()
    source = {**_chunk().__dict__}
    source["created_at"] = source["created_at"].isoformat()
    source["enrichment"] = {**source["enrichment"].__dict__, "status": "succeeded"}
    for field in (
        "section_path",
        "block_ids",
        "asset_refs",
        "important_kwd",
        "question_kwd",
        "tags",
        "entity_refs",
    ):
        source[field] = list(source[field])
    source["chunk_ordinal"] = 1
    source["content_vector"] = []
    client.search_responses = [
        {"hits": {"hits": [{"_id": "chunk-1", "_score": 12.0, "_source": source}]}},
        {"hits": {"hits": [{"_id": "chunk-1", "_score": 0.9, "_source": source}]}},
        {"hits": {"hits": [{"_id": "chunk-1", "_score": 0.91}]}},
    ]
    repository = ElasticsearchRepository(
        client=client,
        embedding_profile_id="profile-1",
        vector_dimensions=3,
        num_candidates=128,
    )
    filters = {
        "tags": {"all": ["approved"]},
        "entity_refs": {"all": ["project:apollo"]},
    }

    lexical_hits = await repository.lexical_search("apollo", "kb-1", filters, 64)
    vector_hits = await repository.knn_search([0.1, 0.2, 0.3], "kb-1", filters, 64)
    scores = await repository.vector_scores(
        [0.1, 0.2, 0.3], "kb-1", ["chunk-1"], filters
    )

    assert lexical_hits[0].chunk.content_vector == ()
    assert vector_hits[0].chunk.content_vector == ()
    assert scores == {"chunk-1": 0.91}
    lexical_body = client.search_calls[0]["body"]
    assert lexical_body["_source"] == {"excludes": ["content_vector"]}
    assert "knn" not in lexical_body
    lexical_queries = lexical_body["query"]["bool"]["must"][0]["bool"]["should"]
    assert lexical_queries[0] == {
        "match": {"important_kwd": {"query": "apollo", "boost": 30}}
    }
    assert lexical_queries[1]["multi_match"]["fields"] == [
        "important_tks^20",
        "question_tks^20",
        "title_tks^10",
        "title_sm_tks^5",
        "content_ltks^2",
        "content_sm_ltks^1",
    ]
    knn_body = client.search_calls[1]["body"]
    assert knn_body["_source"] == {"excludes": ["content_vector"]}
    assert "query" not in knn_body
    assert knn_body["knn"]["k"] == 64
    assert knn_body["knn"]["num_candidates"] == 128
    assert lexical_body["query"]["bool"]["filter"] == knn_body["knn"]["filter"]
    assert client.search_calls[2]["body"]["_source"] is False


@pytest.mark.asyncio
async def test_lexical_query_tokenizes_chinese_for_whitespace_fields() -> None:
    client = FakeElasticsearchClient()
    repository = ElasticsearchRepository(
        client=client,
        embedding_profile_id="profile-1",
        vector_dimensions=3,
    )

    await repository.lexical_search("阿波罗何时完成", "kb-1", {}, 64)

    lexical_queries = client.search_calls[0]["body"]["query"]["bool"]["must"][0][
        "bool"
    ]["should"]
    assert lexical_queries[1]["multi_match"]["query"] == (
        "阿波罗何时完成 阿 波 罗 何 时 完 成"
    )


def test_effective_filter_compiles_as_interval_overlap() -> None:
    clauses = _filters_to_es(
        {"effective": {"gte": "2026-01-01", "lt": "2026-04-01"}},
        knowledge_base_id="kb-1",
    )

    assert {"term": {"knowledge_base_id": "kb-1"}} in clauses
    assert any("effective_from" in str(clause) for clause in clauses)
    assert any("effective_to" in str(clause) for clause in clauses)
