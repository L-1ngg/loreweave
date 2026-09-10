from __future__ import annotations

import json

import httpx
import pytest

from rag_system.infrastructure.providers.chat_provider import (
    ChatProviderError,
    OpenAICompatibleChatProvider,
)


@pytest.mark.asyncio
async def test_chat_provider_prefers_json_schema() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"keywords":[],"questions":[]}'}}]
            },
        )

    client = httpx.AsyncClient(
        base_url="https://chat.example/v1/", transport=httpx.MockTransport(handler)
    )
    provider = OpenAICompatibleChatProvider(
        base_url="https://chat.example/v1",
        api_key="secret",
        model="model-a",
        client=client,
    )
    result = await provider.complete_json(
        system_prompt="system",
        user_prompt="user",
        schema_name="result",
        schema={"type": "object"},
    )
    assert "secret" not in repr(provider)
    assert result == {"keywords": [], "questions": []}
    assert requests[0]["response_format"]["type"] == "json_schema"
    assert requests[0]["temperature"] == 0.2
    await client.aclose()


@pytest.mark.asyncio
async def test_chat_provider_falls_back_to_json_prompt_when_schema_is_rejected() -> (
    None
):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(400, json={"error": "unsupported"})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '```json\n{"value":1}\n```'}}]},
        )

    client = httpx.AsyncClient(
        base_url="https://chat.example/v1/", transport=httpx.MockTransport(handler)
    )
    provider = OpenAICompatibleChatProvider(
        base_url="https://chat.example/v1",
        api_key="secret",
        model="model-a",
        client=client,
    )
    result = await provider.complete_json(
        system_prompt="system",
        user_prompt="user",
        schema_name="result",
        schema={"type": "object"},
    )
    assert result == {"value": 1}
    assert "response_format" not in requests[1]
    assert "Return only one valid JSON object" in requests[1]["messages"][0]["content"]
    await client.aclose()


@pytest.mark.asyncio
async def test_generation_provider_settings_control_temperature_and_output_limit() -> (
    None
):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok":true}'}}]},
        )

    client = httpx.AsyncClient(
        base_url="https://generation.example/v1/",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenAICompatibleChatProvider(
        base_url="https://generation.example/v1",
        api_key="secret",
        model="answer-model",
        temperature=0.0,
        max_tokens=321,
        client=client,
    )

    await provider.complete_json(
        system_prompt="system",
        user_prompt="user",
        schema_name="answer",
        schema={"type": "object"},
    )

    assert requests[0]["temperature"] == 0.0
    assert requests[0]["max_tokens"] == 321
    await client.aclose()


@pytest.mark.asyncio
async def test_chat_provider_redacts_invalid_json_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "not-json provider secret response"}}
                ]
            },
        )

    client = httpx.AsyncClient(
        base_url="https://generation.example/v1/",
        transport=httpx.MockTransport(handler),
    )
    provider = OpenAICompatibleChatProvider(
        base_url="https://generation.example/v1",
        api_key="secret",
        model="answer-model",
        client=client,
    )

    with pytest.raises(ChatProviderError, match="invalid JSON") as exc_info:
        await provider.complete_json(
            system_prompt="system",
            user_prompt="user",
            schema_name="answer",
            schema={"type": "object"},
        )

    assert "provider secret" not in str(exc_info.value)
    await client.aclose()
