from __future__ import annotations

from collections.abc import Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import math
from typing import Any

import httpx

from ..config import Settings


def _batched(values: Sequence[str], size: int) -> list[list[str]]:
    return [list(values[index : index + size]) for index in range(0, len(values), size)]


def _as_float_vector(values: Sequence[Any]) -> list[float]:
    vector: list[float] = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("embedding values must be numbers")
        converted = float(value)
        if not math.isfinite(converted):
            raise ValueError("embedding values must be finite numbers")
        vector.append(converted)
    return vector


@dataclass(slots=True)
class OpenAICompatibleEmbeddingProvider:
    base_url: str
    api_key: str = field(repr=False)
    model: str
    dimensions: int
    send_dimensions: bool = False
    batch_size: int = 32
    timeout_seconds: float = 60.0
    client: httpx.AsyncClient | None = None

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if self.batch_size < 1:
            raise ValueError("batch_size must be positive")
        if self.dimensions < 1:
            raise ValueError("dimensions must be positive")

    @classmethod
    def from_settings(
        cls, settings: Settings, *, client: httpx.AsyncClient | None = None
    ) -> "OpenAICompatibleEmbeddingProvider":
        embedding = settings.embedding
        return cls(
            base_url=embedding.base_url,
            api_key=embedding.api_key.get_secret_value(),
            model=embedding.model,
            dimensions=embedding.dimensions,
            send_dimensions=embedding.send_dimensions,
            batch_size=embedding.batch_size,
            client=client,
        )

    @property
    def profile_id(self) -> str:
        return f"openai-compatible:{self.model}:{self.dimensions}:cosine:v1"

    @asynccontextmanager
    async def _client(self) -> Any:
        if self.client is not None:
            yield self.client
            return
        async with httpx.AsyncClient(
            base_url=f"{self.base_url}/",
            timeout=self.timeout_seconds,
            headers=self._headers(),
        ) as client:
            yield client

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        items = list(texts)
        if not items:
            return []

        embeddings: list[list[float]] = []
        async with self._client() as client:
            for batch in _batched(items, self.batch_size):
                payload: dict[str, Any] = {
                    "model": self.model,
                    "input": batch,
                }
                if self.send_dimensions:
                    payload["dimensions"] = self.dimensions
                response = await client.post(
                    "embeddings",
                    json=payload,
                    headers=self._headers(),
                )
                response.raise_for_status()
                embeddings.extend(self._parse_response(response.json(), len(batch)))
        return embeddings

    def _parse_response(self, payload: Any, expected_count: int) -> list[list[float]]:
        if not isinstance(payload, dict):
            raise ValueError("embedding response must be a JSON object")
        if payload.get("model") not in {None, self.model}:
            raise ValueError("embedding response model does not match request")
        data = payload.get("data")
        if not isinstance(data, list):
            raise ValueError("embedding response must contain a data list")

        by_index: dict[int, list[float]] = {}
        for item in data:
            if not isinstance(item, dict):
                raise ValueError("embedding response items must be objects")
            index = item.get("index")
            embedding = item.get("embedding")
            if isinstance(index, bool) or not isinstance(index, int):
                raise ValueError(
                    "embedding response items must include an integer index"
                )
            if index < 0 or index >= expected_count:
                raise ValueError("embedding response index is out of range")
            if index in by_index:
                raise ValueError("embedding response contains duplicate indexes")
            if not isinstance(embedding, list):
                raise ValueError(
                    "embedding response items must include an embedding list"
                )
            if len(embedding) != self.dimensions:
                raise ValueError(
                    "embedding dimensions do not match the configured profile"
                )
            by_index[index] = _as_float_vector(embedding)

        if len(by_index) != expected_count:
            raise ValueError("embedding response count does not match the request")
        return [by_index[index] for index in range(expected_count)]
