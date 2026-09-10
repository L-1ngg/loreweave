from __future__ import annotations

from collections.abc import Sequence
import math

from ..domain.models import Chunk
from ..domain.ports import EmbeddingProvider
from .chunking import retrieval_text_for_chunk


async def embed_enriched_chunks(
    provider: EmbeddingProvider,
    chunks: Sequence[Chunk],
) -> list[Chunk]:
    """Build the fixed title/semantic mixture used by the ingestion pipeline."""

    items = list(chunks)
    if not items:
        return []
    title = items[0].title
    semantic = []
    for chunk in items:
        body = "\n".join(chunk.question_kwd) if chunk.question_kwd else chunk.content
        semantic.append(retrieval_text_for_chunk(chunk, body))
    title_vectors = await provider.embed([title])
    if len(title_vectors) != 1:
        raise ValueError("title embedding response count does not match request")
    title_vector = title_vectors[0]
    semantic_vectors = await provider.embed(semantic)
    if len(semantic_vectors) != len(items):
        raise ValueError("embedding response count does not match chunks")
    if len(title_vector) != provider.dimensions:
        raise ValueError("title embedding dimensions do not match profile")
    enriched: list[Chunk] = []
    for chunk, semantic_vector in zip(items, semantic_vectors, strict=True):
        if len(semantic_vector) != provider.dimensions:
            raise ValueError("semantic embedding dimensions do not match profile")
        mixed = [
            0.1 * left + 0.9 * right
            for left, right in zip(title_vector, semantic_vector, strict=True)
        ]
        norm = math.sqrt(sum(value * value for value in mixed))
        if norm == 0:
            raise ValueError("mixed embedding vector cannot be zero")
        vector = tuple(value / norm for value in mixed)
        enriched.append(Chunk(**{**chunk.__dict__, "content_vector": vector}))
    return enriched
