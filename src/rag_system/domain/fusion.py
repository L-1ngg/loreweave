from __future__ import annotations

from collections.abc import Sequence

from .models import Chunk, RankedChunk


def rrf_fuse(
    rankings: Sequence[Sequence[RankedChunk]], *, k: int = 60
) -> list[RankedChunk]:
    """Fuse ranked lists by reciprocal rank, preserving the union of candidates."""

    if k < 1:
        raise ValueError("rrf k must be positive")
    scores: dict[str, float] = {}
    chunks: dict[str, Chunk] = {}
    for ranking in rankings:
        for item in ranking:
            chunk_id = item.chunk.chunk_id
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + item.rank)
            chunks.setdefault(chunk_id, item.chunk)
    ordered = sorted(scores, key=lambda chunk_id: (-scores[chunk_id], chunk_id))
    return [
        RankedChunk(chunk=chunks[chunk_id], rank=rank, score=scores[chunk_id])
        for rank, chunk_id in enumerate(ordered, 1)
    ]
