from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import json
from typing import Any

import httpx

from ..config import Settings


class ChatProviderError(RuntimeError):
    """A provider failure with a message safe to record in job diagnostics."""


@dataclass(slots=True)
class OpenAICompatibleChatProvider:
    """Small, provider-neutral adapter for OpenAI-compatible chat endpoints.

    Embeddings and chat deliberately have separate adapters and configuration. A
    chat endpoint may support JSON schema or only plain JSON prompting; both
    paths are handled without leaking provider response bodies into logs.
    """

    base_url: str
    api_key: str = field(repr=False)
    model: str
    timeout_seconds: float = 60.0
    concurrency: int = 4
    temperature: float = 0.2
    max_tokens: int | None = None
    client: httpx.AsyncClient | None = None
    _semaphore: asyncio.Semaphore = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if not self.base_url or not self.model:
            raise ValueError("chat base_url and model are required")
        if self.timeout_seconds <= 0 or self.concurrency < 1:
            raise ValueError("chat timeout and concurrency must be positive")
        if not 0 <= self.temperature <= 2:
            raise ValueError("chat temperature must be between 0 and 2")
        if self.max_tokens is not None and self.max_tokens < 1:
            raise ValueError("chat max_tokens must be positive")
        self._semaphore = asyncio.Semaphore(self.concurrency)

    @classmethod
    def from_settings(
        cls, settings: Settings, *, client: httpx.AsyncClient | None = None
    ) -> "OpenAICompatibleChatProvider":
        return cls(
            base_url=settings.chat.base_url,
            api_key=settings.chat.api_key.get_secret_value(),
            model=settings.indexing.enrichment.model,
            timeout_seconds=settings.chat.timeout_seconds,
            concurrency=settings.chat.concurrency,
            client=client,
        )

    @classmethod
    def from_generation_settings(
        cls, settings: Settings, *, client: httpx.AsyncClient | None = None
    ) -> "OpenAICompatibleChatProvider":
        generation = settings.generation
        return cls(
            base_url=generation.base_url,
            api_key=generation.api_key.get_secret_value(),
            model=generation.model,
            timeout_seconds=generation.timeout_seconds,
            concurrency=generation.concurrency,
            temperature=generation.temperature,
            max_tokens=generation.max_tokens,
            client=client,
        )

    @property
    def model_id(self) -> str:
        return self.model

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @asynccontextmanager
    async def _client(self):
        if self.client is not None:
            yield self.client
            return
        async with httpx.AsyncClient(
            base_url=f"{self.base_url}/",
            timeout=self.timeout_seconds,
            headers=self._headers(),
        ) as client:
            yield client

    async def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        async with self._semaphore:
            async with self._client() as client:
                try:
                    response = await self._request(
                        client,
                        messages=messages,
                        response_format={
                            "type": "json_schema",
                            "json_schema": {
                                "name": schema_name,
                                "strict": True,
                                "schema": schema,
                            },
                        },
                    )
                except httpx.HTTPStatusError as exc:
                    # A number of compatible endpoints reject json_schema while
                    # accepting JSON mode or a plain prompt.
                    if exc.response.status_code not in {400, 404, 415, 422}:
                        raise ChatProviderError("chat provider request failed") from exc
                    fallback_system = (
                        f"{system_prompt}\nReturn only one valid JSON object matching "
                        f"this schema, with no markdown fences:\n{json.dumps(schema)}"
                    )
                    try:
                        response = await self._request(
                            client,
                            messages=[
                                {"role": "system", "content": fallback_system},
                                {"role": "user", "content": user_prompt},
                            ],
                            response_format=None,
                        )
                    except (httpx.HTTPError, TimeoutError) as fallback_exc:
                        raise ChatProviderError(
                            "chat provider JSON fallback failed"
                        ) from fallback_exc
                except (httpx.HTTPError, TimeoutError) as exc:
                    raise ChatProviderError("chat provider request failed") from exc
        return _parse_message_json(response)

    async def _request(
        self,
        client: httpx.AsyncClient,
        *,
        messages: list[dict[str, str]],
        response_format: dict[str, Any] | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
        }
        if self.max_tokens is not None:
            payload["max_tokens"] = self.max_tokens
        if response_format is not None:
            payload["response_format"] = response_format
        response = await client.post(
            "chat/completions",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ChatProviderError("chat provider returned an invalid response")
        return payload


def _parse_message_json(payload: dict[str, Any]) -> dict[str, Any]:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ChatProviderError("chat provider response contains no choice")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ChatProviderError("chat provider response contains no message")
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        )
    if not isinstance(content, str):
        raise ChatProviderError("chat provider response content is not text")
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`").strip()
        if content.lower().startswith("json"):
            content = content[4:].lstrip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ChatProviderError("chat provider returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise ChatProviderError("chat provider JSON result must be an object")
    return parsed
