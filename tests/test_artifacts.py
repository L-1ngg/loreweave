from __future__ import annotations

import json

import pytest

from rag_system.processing.artifacts import (
    build_embedded_artifact,
    load_embedded_artifact,
)
from test_enrichment import _chunk


def test_embedded_artifact_round_trips_and_rejects_tampering() -> None:
    chunk = _chunk()
    data, checksum = build_embedded_artifact(
        revision_id="rev-1", revision_fingerprint="fingerprint", chunks=[chunk]
    )

    payload, chunks = load_embedded_artifact(data)

    assert payload["chunk_count"] == 1
    assert chunks[0].content == chunk.content
    assert len(checksum) == 64

    tampered = json.loads(data)
    tampered["chunks"][0]["content"] = "changed"
    with pytest.raises(ValueError, match="checksum mismatch"):
        load_embedded_artifact(json.dumps(tampered).encode())
