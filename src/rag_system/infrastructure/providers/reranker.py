from __future__ import annotations

from collections.abc import Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import math
from typing import Any

import httpx

from ..config import Settings


@dataclass(slots=True)
class HttpRerankerProvider:
    """Jina/TEI-compatible cross-encoder reranker over HTTP."""

    base_url: str
    api_key: str = field(repr=False)
    model: str
    timeout_seconds: float = 30.0
    client: httpx.AsyncClient | None = None

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    @classmethod
    def from_settings(
        cls, settings: Settings, *, client: httpx.AsyncClient | None = None
    ) -> "HttpRerankerProvider":
        rerank = settings.retrieval.rerank
        return cls(
            base_url=rerank.base_url,
            api_key=rerank.api_key.get_secret_value(),
            model=rerank.model,
            timeout_seconds=rerank.timeout_seconds,
            client=client,
        )

    @property
    def model_id(self) -> str:
        return self.model

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

    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]:
        items = list(documents)
        if not items:
            return []
        payload: dict[str, Any] = {
            "model": self.model,
            "query": query,
            "documents": items,
            "top_n": len(items),
        }
        async with self._client() as client:
            response = await client.post(
                "rerank",
                json=payload,
                headers=self._headers(),
            )
            response.raise_for_status()
            return self._parse_response(response.json(), len(items))

    def _parse_response(self, payload: Any, expected_count: int) -> list[float]:
        # Jina-style object: {"results": [{"index": i, "relevance_score": s}]}
        # TEI-style list: [{"index": i, "score": s}]
        if isinstance(payload, dict):
            payload = payload.get("results")
        if not isinstance(payload, list):
            raise ValueError("rerank response must contain a results list")
        scores: dict[int, float] = {}
        for item in payload:
            if not isinstance(item, dict):
                raise ValueError("rerank response items must be objects")
            index = item.get("index")
            raw = item.get("relevance_score", item.get("score"))
            if isinstance(index, bool) or not isinstance(index, int):
                raise ValueError("rerank response items must include an integer index")
            if index < 0 or index >= expected_count:
                raise ValueError("rerank response index is out of range")
            if index in scores:
                raise ValueError("rerank response contains duplicate indexes")
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ValueError("rerank response scores must be numbers")
            score = float(raw)
            if not math.isfinite(score):
                raise ValueError("rerank response scores must be finite numbers")
            scores[index] = score
        if len(scores) != expected_count:
            raise ValueError("rerank response count does not match the request")
        return [scores[index] for index in range(expected_count)]
