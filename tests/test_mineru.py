from __future__ import annotations

import json
import httpx
import pytest

from rag_system.infrastructure.providers.mineru import MinerUError, MinerUParser
from rag_system.domain.models import ParserTaskState, RemoteParseTask


@pytest.mark.asyncio
async def test_submit_uses_v4_endpoint_and_defaults_missing_state_to_pending() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://mineru.net/api/v4/extract/task"
        assert request.headers["Authorization"] == "Bearer secret-token"
        assert json.loads(request.content) == {
            "url": "https://storage.example.com/source.pdf",
            "model_version": "vlm",
            "data_id": "doc-rev-1",
            "language": "en",
        }
        return httpx.Response(
            200,
            json={"code": 0, "data": {"task_id": "task-1"}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            model_version="vlm",
            language="en",
            client=client,
        ) as parser:
            task = await parser.submit(
                "https://storage.example.com/source.pdf",
                "source.pdf",
                "doc-rev-1",
            )

    assert task.task_id == "task-1"
    assert task.state is ParserTaskState.PENDING
    assert task.progress["remote_state"] == "pending"


@pytest.mark.asyncio
async def test_submit_uses_mineru_html_for_html_sources() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["model_version"] == "MinerU-HTML"
        assert "file_name" not in payload
        return httpx.Response(
            200,
            json={"code": 0, "data": {"task_id": "task-html", "state": "pending"}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            model_version="vlm",
            language="en",
            client=client,
        ) as parser:
            task = await parser.submit(
                "https://storage.example.com/index.html",
                "index.html",
                "doc-rev-html",
            )

    assert task.task_id == "task-html"
    assert task.state is ParserTaskState.PENDING


@pytest.mark.asyncio
async def test_upload_mode_pushes_source_bytes_and_returns_batch_task() -> None:
    uploaded: dict[str, bytes] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v4/file-urls/batch":
            assert request.method == "POST"
            assert request.headers["Authorization"] == "Bearer secret-token"
            assert json.loads(request.content) == {
                "files": [{"name": "source.pdf", "data_id": "doc-rev-1"}],
                "model_version": "vlm",
                "language": "en",
            }
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "batch_id": "batch-1",
                        "file_urls": ["https://oss.example.com/upload/1"],
                    },
                },
            )
        if str(request.url) == "https://storage.local/source.pdf":
            assert request.method == "GET"
            return httpx.Response(200, content=b"%PDF-fake")
        if str(request.url) == "https://oss.example.com/upload/1":
            assert request.method == "PUT"
            uploaded["body"] = request.content
            return httpx.Response(200)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            submission_mode="upload",
            model_version="vlm",
            language="en",
            client=client,
        ) as parser:
            task = await parser.submit(
                "https://storage.local/source.pdf", "source.pdf", "doc-rev-1"
            )

    assert task.task_id == "batch:batch-1"
    assert task.state is ParserTaskState.PENDING
    assert uploaded["body"] == b"%PDF-fake"


@pytest.mark.asyncio
async def test_get_task_polls_batch_results_for_batch_task_ids() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/v4/extract-results/batch/batch-2"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "batch_id": "batch-2",
                    "extract_result": [
                        {
                            "file_name": "source.pdf",
                            "data_id": "doc-rev-2",
                            "state": "done",
                            "full_zip_url": "https://cdn.example.com/result.zip",
                        }
                    ],
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            submission_mode="upload",
            client=client,
        ) as parser:
            task = await parser.get_task("batch:batch-2")

    assert task.state is ParserTaskState.SUCCEEDED
    assert task.result_url == "https://cdn.example.com/result.zip"


@pytest.mark.asyncio
async def test_batch_waiting_file_state_maps_to_pending() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "batch_id": "batch-3",
                    "extract_result": [
                        {"file_name": "source.pdf", "state": "waiting-file"}
                    ],
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            submission_mode="upload",
            client=client,
        ) as parser:
            task = await parser.get_task("batch:batch-3")

    assert task.state is ParserTaskState.PENDING
    assert task.progress["remote_state"] == "waiting-file"


@pytest.mark.asyncio
async def test_get_task_maps_converting_to_running_and_preserves_zip_url() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/v4/extract/task/task-2"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "task_id": "task-2",
                    "state": "converting",
                    "full_zip_url": "https://cdn.example.com/result.zip",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            client=client,
        ) as parser:
            task = await parser.get_task("task-2")

    assert task.state is ParserTaskState.RUNNING
    assert task.result_url == "https://cdn.example.com/result.zip"
    assert task.progress["remote_state"] == "converting"


@pytest.mark.asyncio
async def test_download_result_enforces_byte_limit() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/archive.zip":
            return httpx.Response(200, content=b"0123456789")
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async with MinerUParser(
            base_url="https://mineru.net",
            api_token="secret-token",
            max_result_bytes=8,
            client=client,
        ) as parser:
            task = RemoteParseTask(
                task_id="task-3",
                state=ParserTaskState.SUCCEEDED,
                result_url="https://mineru.net/archive.zip",
            )
            with pytest.raises(MinerUError, match="max_result_bytes"):
                await parser.download_result(task)
