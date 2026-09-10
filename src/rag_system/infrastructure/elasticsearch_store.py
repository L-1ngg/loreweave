from __future__ import annotations

from collections.abc import Sequence
import base64
import json
from typing import Any

from elasticsearch import AsyncElasticsearch
from elasticsearch.helpers import async_bulk

from ..domain.lexical import coarse_tokens, fine_tokens, token_string
from ..domain.models import Chunk, RankedChunk
from ..domain.ports import SearchRepository
from ..processing.artifacts import deserialize_chunk, serialize_chunk
from .config import Settings


class ElasticsearchRepository(SearchRepository):
    """Search and projection adapter; business state lives in PostgreSQL."""

    def __init__(
        self,
        *,
        client: Any,
        chunks_index: str = "rag-chunks-v2",
        chunks_alias: str = "rag-chunks",
        embedding_profile_id: str = "",
        vector_dimensions: int = 0,
        candidate_k: int = 64,
        num_candidates: int = 128,
    ) -> None:
        self.client = client
        self.chunks_index = chunks_index
        self.chunks_alias = chunks_alias
        self.embedding_profile_id = embedding_profile_id
        self.vector_dimensions = vector_dimensions
        self.candidate_k = candidate_k
        self.num_candidates = num_candidates

    @classmethod
    def from_settings(cls, settings: Settings) -> "ElasticsearchRepository":
        storage = settings.storage
        kwargs: dict[str, Any] = {"verify_certs": storage.elasticsearch_verify_certs}
        if storage.elasticsearch_api_key:
            kwargs["api_key"] = storage.elasticsearch_api_key.get_secret_value()
        elif storage.elasticsearch_username:
            kwargs["basic_auth"] = (
                storage.elasticsearch_username,
                storage.elasticsearch_password.get_secret_value(),
            )
        return cls(
            client=AsyncElasticsearch(storage.elasticsearch_url, **kwargs),
            chunks_index=settings.chunks_index,
            chunks_alias=f"{storage.elasticsearch_index_prefix}-chunks",
            embedding_profile_id=settings.embedding_profile_id,
            vector_dimensions=settings.embedding.dimensions,
            candidate_k=settings.retrieval.candidate_k,
            num_candidates=settings.retrieval.num_candidates,
        )

    async def ensure_index(self) -> None:
        if not await self.client.indices.exists(index=self.chunks_index):
            await self.client.indices.create(
                index=self.chunks_index,
                aliases={self.chunks_alias: {}},
                settings=self._index_settings(),
                mappings=self._chunk_mappings(),
            )
        elif not await self.client.indices.exists_alias(name=self.chunks_alias):
            await self.client.indices.put_alias(
                index=self.chunks_index,
                name=self.chunks_alias,
            )
        await self.verify_mapping()

    async def validate_index(self) -> None:
        if not await self.client.indices.exists_alias(name=self.chunks_alias):
            raise RuntimeError(f"Elasticsearch alias {self.chunks_alias!r} is missing")
        await self.verify_mapping()

    async def create_physical_index(self, index: str) -> None:
        if await self.client.indices.exists(index=index):
            raise ValueError(f"Elasticsearch index {index!r} already exists")
        await self.client.indices.create(
            index=index,
            settings=self._index_settings(),
            mappings=self._chunk_mappings(),
        )

    async def current_alias_indices(self) -> list[str]:
        try:
            response = await self.client.indices.get_alias(name=self.chunks_alias)
        except Exception as exc:  # noqa: BLE001
            if getattr(exc, "status_code", None) == 404:
                return []
            raise
        return sorted(response)

    async def count_chunks(
        self, *, index: str, knowledge_base_id: str | None = None
    ) -> int:
        query = (
            {"term": {"knowledge_base_id": knowledge_base_id}}
            if knowledge_base_id is not None
            else {"match_all": {}}
        )
        response = await self.client.count(
            index=index,
            query=query,
        )
        return int(response.get("count", 0))

    async def list_chunk_checksums(
        self, *, index: str, knowledge_base_id: str | None = None
    ) -> list[str]:
        query = (
            {"term": {"knowledge_base_id": knowledge_base_id}}
            if knowledge_base_id is not None
            else {"match_all": {}}
        )
        checksums: list[str] = []
        search_after: list[Any] | None = None
        while True:
            body: dict[str, Any] = {
                "size": 1000,
                "_source": ["checksum"],
                "query": query,
                "sort": [{"chunk_id": "asc"}],
            }
            if search_after is not None:
                body["search_after"] = search_after
            response = await self.client.search(index=index, body=body)
            hits = response.get("hits", {}).get("hits", [])
            checksums.extend(
                str(hit["_source"]["checksum"])
                for hit in hits
                if hit.get("_source", {}).get("checksum")
            )
            if len(hits) < 1000 or not hits[-1].get("sort"):
                break
            search_after = hits[-1]["sort"]
        return checksums

    async def verify_mapping(self) -> None:
        response = await self.client.indices.get_mapping(index=self.chunks_alias)
        if not response:
            raise RuntimeError("rag-chunks alias has no mapping")
        mapping = next(iter(response.values())).get("mappings", {})
        meta = mapping.get("_meta", {})
        if meta.get("mapping_version") != "v2":
            raise RuntimeError("rag-chunks mapping version is not v2")
        if (
            self.embedding_profile_id
            and meta.get("embedding_profile_id") != self.embedding_profile_id
        ):
            raise RuntimeError("rag-chunks embedding profile does not match settings")
        if (
            self.vector_dimensions
            and meta.get("vector_dimensions") != self.vector_dimensions
        ):
            raise RuntimeError("rag-chunks vector dimensions do not match settings")

    async def project_chunks(
        self,
        chunks: Sequence[Chunk],
        *,
        index: str | None = None,
        refresh: str = "wait_for",
    ) -> None:
        target = index or self.chunks_alias
        actions = (
            {
                "_op_type": "index",
                "_index": target,
                "_id": chunk.chunk_id,
                "_source": _projection_source(chunk),
            }
            for chunk in chunks
        )
        _success, errors = await async_bulk(
            self.client,
            actions,
            chunk_size=500,
            refresh=refresh,
            raise_on_error=False,
        )
        if errors:
            raise RuntimeError(
                f"Elasticsearch bulk projection failed for {len(errors)} items"
            )

    async def delete_revision(
        self, revision_id: str, *, index: str | None = None, refresh: bool = True
    ) -> None:
        await self.delete_revisions([revision_id], index=index, refresh=refresh)

    async def delete_revisions(
        self,
        revision_ids: Sequence[str],
        *,
        index: str | None = None,
        refresh: bool = True,
    ) -> None:
        unique_ids = list(dict.fromkeys(revision_ids))
        if not unique_ids:
            return
        await self.client.delete_by_query(
            index=index or self.chunks_alias,
            query={"terms": {"document_revision_id": unique_ids}},
            refresh=refresh,
            conflicts="proceed",
        )

    async def lexical_search(
        self,
        query: str,
        knowledge_base_id: str,
        filters: dict[str, Any],
        limit: int,
    ) -> list[RankedChunk]:
        filter_dsl = _filters_to_es(filters, knowledge_base_id=knowledge_base_id)
        tokenized_query = _tokenized_lexical_query(query)
        body = {
            "size": limit,
            "_source": {"excludes": ["content_vector"]},
            "query": {
                "bool": {
                    "filter": filter_dsl,
                    "must": [
                        {
                            "bool": {
                                "should": [
                                    {
                                        "match": {
                                            "important_kwd": {
                                                "query": query,
                                                "boost": 30,
                                            }
                                        }
                                    },
                                    {
                                        "multi_match": {
                                            "query": tokenized_query,
                                            "fields": [
                                                "important_tks^20",
                                                "question_tks^20",
                                                "title_tks^10",
                                                "title_sm_tks^5",
                                                "content_ltks^2",
                                                "content_sm_ltks^1",
                                            ],
                                            "type": "best_fields",
                                        }
                                    },
                                ],
                                "minimum_should_match": 1,
                            }
                        }
                    ],
                }
            },
        }
        response = await self.client.search(index=self.chunks_alias, body=body)
        return _ranked_chunks(response)

    async def knn_search(
        self,
        vector: Sequence[float],
        knowledge_base_id: str,
        filters: dict[str, Any],
        limit: int,
    ) -> list[RankedChunk]:
        filter_dsl = _filters_to_es(filters, knowledge_base_id=knowledge_base_id)
        body = {
            "size": limit,
            "_source": {"excludes": ["content_vector"]},
            "knn": {
                "field": "content_vector",
                "query_vector": list(vector),
                "k": limit,
                "num_candidates": max(limit, self.num_candidates),
                "filter": filter_dsl,
            },
        }
        response = await self.client.search(index=self.chunks_alias, body=body)
        return _ranked_chunks(response)

    async def vector_scores(
        self,
        vector: Sequence[float],
        knowledge_base_id: str,
        candidate_ids: Sequence[str],
        filters: dict[str, Any],
    ) -> dict[str, float]:
        if not candidate_ids:
            return {}
        filter_dsl = _filters_to_es(filters, knowledge_base_id=knowledge_base_id)
        filter_dsl.append({"ids": {"values": list(candidate_ids)}})
        response = await self.client.search(
            index=self.chunks_alias,
            body={
                "size": len(candidate_ids),
                "_source": False,
                "knn": {
                    "field": "content_vector",
                    "query_vector": list(vector),
                    "k": len(candidate_ids),
                    "num_candidates": max(len(candidate_ids), self.num_candidates),
                    "filter": filter_dsl,
                },
            },
        )
        return {
            str(hit.get("_id")): float(hit.get("_score") or 0.0)
            for hit in response.get("hits", {}).get("hits", [])
        }

    async def get_chunk(self, chunk_id: str) -> Chunk | None:
        try:
            response = await self.client.get(
                index=self.chunks_alias,
                id=chunk_id,
                source_excludes=["content_vector"],
            )
        except Exception as exc:  # noqa: BLE001
            if (
                exc.__class__.__name__ in {"NotFoundError", "KeyError"}
                or getattr(exc, "status_code", None) == 404
            ):
                return None
            raise
        source = response.get("_source")
        return _projection_chunk(source) if isinstance(source, dict) else None

    async def get_adjacent_chunks(
        self, chunk: Chunk, before: int, after: int
    ) -> list[Chunk]:
        ordinal = chunk.metadata.get("chunk_ordinal")
        if not isinstance(ordinal, int):
            return []
        response = await self.client.search(
            index=self.chunks_alias,
            body={
                "size": before + after + 1,
                "_source": {"excludes": ["content_vector"]},
                "query": {
                    "bool": {
                        "filter": [
                            {"term": {"knowledge_base_id": chunk.knowledge_base_id}},
                            {
                                "term": {
                                    "document_revision_id": chunk.document_revision_id
                                }
                            },
                            {
                                "range": {
                                    "chunk_ordinal": {
                                        "gte": max(0, ordinal - before),
                                        "lte": ordinal + after,
                                    }
                                }
                            },
                        ]
                    }
                },
                "sort": [
                    {"chunk_ordinal": {"order": "asc"}},
                    {"chunk_id": {"order": "asc"}},
                ],
            },
        )
        return [
            _projection_chunk(hit["_source"])
            for hit in response.get("hits", {}).get("hits", [])
            if isinstance(hit.get("_source"), dict)
        ]

    async def cutover_alias(
        self,
        new_index: str,
        *,
        old_index: str | None = None,
        old_indices: Sequence[str] = (),
    ) -> None:
        actions: list[dict[str, Any]] = []
        remove_indices = list(old_indices)
        if old_index and old_index not in remove_indices:
            remove_indices.append(old_index)
        actions.extend(
            {"remove": {"index": index, "alias": self.chunks_alias}}
            for index in remove_indices
        )
        actions.append({"add": {"index": new_index, "alias": self.chunks_alias}})
        await self.client.indices.update_aliases(actions=actions)

    def _index_settings(self) -> dict[str, Any]:
        return {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "similarity": {"rag_idf": {"type": "BM25", "k1": 1.2, "b": 0.0}},
            "analysis": {
                "normalizer": {
                    "rag_keyword_lower": {
                        "type": "custom",
                        "filter": ["lowercase"],
                    }
                },
                "analyzer": {
                    "rag_whitespace": {"type": "custom", "tokenizer": "whitespace"}
                },
            },
        }

    def _chunk_mappings(self) -> dict[str, Any]:
        provenance = {
            "type": "object",
            "dynamic": "strict",
            "properties": {
                "status": {"type": "keyword"},
                "model": {"type": "keyword"},
                "prompt_version": {"type": "keyword"},
                "cache_key": {"type": "keyword"},
                "language": {"type": "keyword"},
                "keyword_top_n": {"type": "integer"},
                "question_top_n": {"type": "integer"},
                "generated_keywords": {"type": "boolean"},
                "generated_questions": {"type": "boolean"},
                "error_summary": {"type": "text", "index": False},
            },
        }
        text = {"type": "text", "analyzer": "rag_whitespace", "similarity": "rag_idf"}
        return {
            "dynamic": "strict",
            "_meta": {
                "mapping_version": "v2",
                "embedding_profile_id": self.embedding_profile_id,
                "vector_dimensions": self.vector_dimensions,
                "lexical_boosts": {
                    "important_kwd": 30,
                    "important_tks": 20,
                    "question_tks": 20,
                    "title_tks": 10,
                    "title_sm_tks": 5,
                    "content_ltks": 2,
                    "content_sm_ltks": 1,
                },
            },
            "properties": {
                "chunk_id": {"type": "keyword"},
                "document_id": {"type": "keyword"},
                "document_revision_id": {"type": "keyword"},
                "knowledge_base_id": {"type": "keyword"},
                "title": {"type": "keyword", "ignore_above": 512},
                "title_tks": text,
                "title_sm_tks": text,
                "important_kwd": {
                    "type": "keyword",
                    "normalizer": "rag_keyword_lower",
                    "ignore_above": 512,
                },
                "important_tks": text,
                "question_kwd": {"type": "keyword", "ignore_above": 1024},
                "question_tks": text,
                "content_ltks": text,
                "content_sm_ltks": text,
                "content": {"type": "text", "index": False},
                "content_with_weight": {"type": "text", "index": False},
                "content_vector": {
                    "type": "dense_vector",
                    "dims": self.vector_dimensions,
                    "index": True,
                    "similarity": "cosine",
                },
                "section_path": {"type": "keyword"},
                "page_start": {"type": "integer"},
                "page_end": {"type": "integer"},
                "block_ids": {"type": "keyword"},
                "asset_refs": {"type": "keyword"},
                "source_object_key": {"type": "keyword"},
                "embedding_profile_id": {"type": "keyword"},
                "chunking_version": {"type": "keyword"},
                "chunk_ordinal": {"type": "integer"},
                "source_type": {"type": "keyword"},
                "language": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "source_date": {"type": "date"},
                "effective_from": {"type": "date"},
                "effective_to": {"type": "date"},
                "created_at": {"type": "date"},
                "entity_refs": {"type": "keyword"},
                "metadata": {"type": "flattened", "index": False},
                "enrichment": provenance,
                "checksum": {"type": "keyword"},
            },
        }


def _chunk_from_hit(hit: dict[str, Any]) -> Chunk:
    source = dict(hit.get("_source") or {})
    if source.get("chunk_id") != hit.get("_id"):
        raise ValueError("Elasticsearch chunk identity mismatch")
    return _projection_chunk(source)


def _ranked_chunks(response: dict[str, Any]) -> list[RankedChunk]:
    return [
        RankedChunk(
            chunk=_chunk_from_hit(hit),
            rank=rank,
            score=float(hit.get("_score") or 0.0),
        )
        for rank, hit in enumerate(response.get("hits", {}).get("hits", []), 1)
    ]


def _projection_chunk(value: dict[str, Any]) -> Chunk:
    data = dict(value)
    ordinal = data.pop("chunk_ordinal", None)
    if isinstance(ordinal, int):
        metadata = dict(data.get("metadata") or {})
        metadata["chunk_ordinal"] = ordinal
        data["metadata"] = metadata
    return deserialize_chunk(data)


def _projection_source(chunk: Chunk) -> dict[str, Any]:
    source = serialize_chunk(chunk)
    metadata = dict(source.get("metadata") or {})
    ordinal = metadata.pop("chunk_ordinal", None)
    source["metadata"] = metadata
    if isinstance(ordinal, int):
        source["chunk_ordinal"] = ordinal
    return source


def _tokenized_lexical_query(query: str) -> str:
    tokens = dict.fromkeys([*coarse_tokens(query), *fine_tokens(query)])
    return token_string(tokens) or query


def _filters_to_es(
    filters: dict[str, Any], *, knowledge_base_id: str
) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = [
        {"term": {"knowledge_base_id": knowledge_base_id}},
        {"exists": {"field": "content_vector"}},
    ]
    if filters.get("__empty__"):
        clauses.append({"term": {"chunk_id": "__no_match__"}})
        return clauses
    for field, value in filters.items():
        if field.startswith("__"):
            continue
        if field in {"source_date", "created_at"}:
            clauses.append({"range": {field: value}})
        elif field == "effective":
            # Interval overlap: document effective_from < query end and
            # effective_to >= query start, with open-ended bounds allowed.
            start = value.get("gte") or value.get("gt")
            end = value.get("lt") or value.get("lte")
            if end:
                clauses.append(
                    {
                        "bool": {
                            "should": [
                                {"range": {"effective_from": {"lt": end}}},
                                {
                                    "bool": {
                                        "must_not": {
                                            "exists": {"field": "effective_from"}
                                        }
                                    }
                                },
                            ],
                            "minimum_should_match": 1,
                        }
                    }
                )
            if start:
                clauses.append(
                    {
                        "bool": {
                            "should": [
                                {"range": {"effective_to": {"gte": start}}},
                                {
                                    "bool": {
                                        "must_not": {
                                            "exists": {"field": "effective_to"}
                                        }
                                    }
                                },
                            ],
                            "minimum_should_match": 1,
                        }
                    }
                )
        elif isinstance(value, dict):
            if value.get("all"):
                clauses.extend({"term": {field: item}} for item in value["all"])
            if value.get("any"):
                clauses.append({"terms": {field: value["any"]}})
            if value.get("none"):
                clauses.append(
                    {"bool": {"must_not": {"terms": {field: value["none"]}}}}
                )
        else:
            clauses.append({"term": {field: value}})
    return clauses


def _encode_cursor(value: Any) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
