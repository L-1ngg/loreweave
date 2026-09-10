from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from hashlib import sha256
import json
from typing import Any

from ..domain.models import Chunk, EnrichmentProvenance, EnrichmentStatus


ARTIFACT_SCHEMA = "chunks.embedded.v2"


def serialize_chunk(chunk: Chunk) -> dict[str, Any]:
    value = asdict(chunk)
    value["created_at"] = chunk.created_at.isoformat()
    for key in ("source_date", "effective_from", "effective_to"):
        if value[key] is not None:
            value[key] = getattr(chunk, key).isoformat()
    value["enrichment"]["status"] = chunk.enrichment.status.value
    return value


def deserialize_chunk(value: dict[str, Any]) -> Chunk:
    data = dict(value)
    data["created_at"] = _datetime(data.get("created_at"))
    for key in ("source_date", "effective_from", "effective_to"):
        data[key] = _datetime(data.get(key))
    for key in (
        "important_kwd",
        "question_kwd",
        "tags",
        "entity_refs",
        "section_path",
        "block_ids",
        "asset_refs",
    ):
        data[key] = tuple(data.get(key) or ())
    data["content_vector"] = tuple(
        float(item) for item in data.get("content_vector") or ()
    )
    enrichment = dict(data["enrichment"])
    enrichment["status"] = EnrichmentStatus(enrichment["status"])
    data["enrichment"] = EnrichmentProvenance(**enrichment)
    return Chunk(**data)


def chunks_checksum(chunks: list[Chunk] | tuple[Chunk, ...]) -> str:
    canonical = json.dumps(
        [serialize_chunk(chunk) for chunk in chunks],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256(canonical).hexdigest()


def build_embedded_artifact(
    *,
    revision_id: str,
    revision_fingerprint: str,
    chunks: list[Chunk] | tuple[Chunk, ...],
) -> tuple[bytes, str]:
    checksum = chunks_checksum(chunks)
    payload = {
        "schema": ARTIFACT_SCHEMA,
        "revision_id": revision_id,
        "revision_fingerprint": revision_fingerprint,
        "chunk_count": len(chunks),
        "chunks_checksum": checksum,
        "chunks": [serialize_chunk(chunk) for chunk in chunks],
    }
    data = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return data, sha256(data).hexdigest()


def load_embedded_artifact(data: bytes) -> tuple[dict[str, Any], tuple[Chunk, ...]]:
    try:
        payload = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("embedded chunks artifact is not valid JSON") from exc
    if not isinstance(payload, dict) or payload.get("schema") != ARTIFACT_SCHEMA:
        raise ValueError("unsupported embedded chunks artifact schema")
    values = payload.get("chunks")
    if not isinstance(values, list):
        raise ValueError("embedded chunks artifact has no chunks list")
    chunks = tuple(
        deserialize_chunk(value) for value in values if isinstance(value, dict)
    )
    if len(chunks) != len(values):
        raise ValueError("embedded chunks artifact contains invalid chunks")
    if payload.get("chunk_count") != len(chunks):
        raise ValueError("embedded chunks artifact count mismatch")
    if payload.get("chunks_checksum") != chunks_checksum(chunks):
        raise ValueError("embedded chunks artifact checksum mismatch")
    return payload, chunks


def _datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    raise ValueError("invalid datetime in embedded chunks artifact")
