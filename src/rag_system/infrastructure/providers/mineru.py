from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import httpx

from ...domain.models import ParseArtifact, ParserTaskState, RemoteParseTask
from ..config import Settings


class MinerUError(ValueError):
    """Raised when MinerU returns an invalid response or a task cannot proceed."""


_BATCH_PREFIX = "batch:"


class MinerUParser:
    """Remote MinerU adapter for asynchronous parsing.

    In "url" mode MinerU pulls the source from a presigned URL; in "upload"
    mode the adapter fetches the source itself and pushes the bytes to a
    MinerU-issued upload URL, so local object storage stays private.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_token: str,
        submission_mode: str = "url",
        model_version: str = "vlm",
        language: str = "ch",
        enable_ocr: bool = False,
        timeout: float = 60.0,
        max_result_bytes: int = 512 * 1024 * 1024,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_token:
            raise ValueError("api_token is required")
        if submission_mode not in {"url", "upload"}:
            raise ValueError("submission_mode must be 'url' or 'upload'")
        if max_result_bytes < 1:
            raise ValueError("max_result_bytes must be positive")

        self._base_url = base_url.rstrip("/")
        self._api_token = api_token
        self._submission_mode = submission_mode
        self._model_version = model_version
        self._language = language
        self._enable_ocr = enable_ocr
        self._timeout = timeout
        self._max_result_bytes = max_result_bytes
        self._client = client or httpx.AsyncClient(timeout=timeout)
        self._owns_client = client is None

    @classmethod
    def from_settings(
        cls, settings: Settings, client: httpx.AsyncClient | None = None
    ) -> "MinerUParser":
        parser = settings.parser
        return cls(
            base_url=parser.base_url,
            api_token=parser.api_token.get_secret_value(),
            submission_mode=parser.submission_mode,
            model_version=parser.model_version,
            language=parser.language,
            enable_ocr=parser.enable_ocr,
            timeout=parser.request_timeout_seconds,
            max_result_bytes=parser.max_result_bytes,
            client=client,
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> "MinerUParser":
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.aclose()

    async def submit(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        if self._submission_mode == "upload":
            return await self._submit_upload(source_url, source_name, data_id)
        payload = {
            "url": source_url,
            "model_version": self._model_version_for_source(source_name),
            "data_id": data_id,
        }
        if self._language:
            payload["language"] = self._language
        if self._enable_ocr:
            payload["is_ocr"] = True

        response = await self._client.post(
            f"{self._base_url}/api/v4/extract/task",
            headers=self._headers(),
            json=payload,
        )
        data = self._unwrap_response(response)
        task_id = str(data.get("task_id") or data.get("id") or "").strip()
        if not task_id:
            raise MinerUError("MinerU submit response missing task_id")
        return self._task_from_payload(task_id, data, default_state="pending")

    async def _submit_upload(
        self, source_url: str, source_name: str, data_id: str
    ) -> RemoteParseTask:
        file_entry: dict[str, object] = {"name": source_name, "data_id": data_id}
        if self._enable_ocr:
            file_entry["is_ocr"] = True
        payload: dict[str, object] = {
            "files": [file_entry],
            "model_version": self._model_version_for_source(source_name),
        }
        if self._language:
            payload["language"] = self._language

        response = await self._client.post(
            f"{self._base_url}/api/v4/file-urls/batch",
            headers=self._headers(),
            json=payload,
        )
        data = self._unwrap_response(response)
        batch_id = str(data.get("batch_id") or "").strip()
        file_urls = data.get("file_urls")
        if not batch_id:
            raise MinerUError("MinerU upload response missing batch_id")
        if not isinstance(file_urls, list) or not file_urls:
            raise MinerUError("MinerU upload response missing file_urls")
        upload_url = str(file_urls[0])

        source = await self._client.get(source_url)
        source.raise_for_status()
        # The presigned upload URL must be PUT without a Content-Type header;
        # MinerU auto-submits the parse task once the upload lands.
        upload = await self._client.put(upload_url, content=source.content)
        upload.raise_for_status()

        return RemoteParseTask(
            task_id=f"{_BATCH_PREFIX}{batch_id}",
            state=ParserTaskState.PENDING,
            progress={"remote_state": "waiting-file"},
        )

    async def get_task(self, task_id: str) -> RemoteParseTask:
        if task_id.startswith(_BATCH_PREFIX):
            return await self._get_batch_task(task_id)
        response = await self._client.get(
            f"{self._base_url}/api/v4/extract/task/{task_id}",
            headers=self._headers(),
        )
        data = self._unwrap_response(response)
        return self._task_from_payload(task_id, data)

    async def _get_batch_task(self, task_id: str) -> RemoteParseTask:
        batch_id = task_id.removeprefix(_BATCH_PREFIX)
        response = await self._client.get(
            f"{self._base_url}/api/v4/extract-results/batch/{batch_id}",
            headers=self._headers(),
        )
        data = self._unwrap_response(response)
        results = data.get("extract_result")
        if not isinstance(results, list) or not results:
            raise MinerUError(f"batch {batch_id} returned no extract_result")
        entry = results[0]
        if not isinstance(entry, Mapping):
            raise MinerUError("MinerU batch entry is not an object")
        return self._task_from_payload(task_id, entry)

    async def download_result(self, task: RemoteParseTask) -> ParseArtifact:
        if task.state is not ParserTaskState.SUCCEEDED:
            raise MinerUError(
                f"cannot download result for non-terminal task state {task.state!s}"
            )

        result_url = task.result_url
        if not result_url:
            refreshed = await self.get_task(task.task_id)
            if refreshed.state is not ParserTaskState.SUCCEEDED:
                raise MinerUError(
                    f"task {task.task_id} is not done yet, remote_state="
                    f"{refreshed.progress.get('remote_state', '')}"
                )
            result_url = refreshed.result_url
        if not result_url:
            raise MinerUError(f"task {task.task_id} completed without a result URL")

        total = 0
        chunks: list[bytes] = []
        async with self._client.stream(
            "GET", result_url, headers={"Accept": "application/zip"}
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > self._max_result_bytes:
                    raise MinerUError(
                        f"MinerU result exceeded max_result_bytes ({self._max_result_bytes})"
                    )
                chunks.append(chunk)

        return ParseArtifact(task_id=task.task_id, archive=b"".join(chunks))

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _unwrap_response(self, response: httpx.Response) -> Mapping[str, object]:
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, Mapping):
            raise MinerUError("MinerU returned a non-object response")
        if payload.get("code", 0) not in {0, "0", None}:
            raise MinerUError(
                str(
                    payload.get("msg")
                    or payload.get("message")
                    or "MinerU request failed"
                )
            )
        data = payload.get("data")
        if not isinstance(data, Mapping):
            raise MinerUError("MinerU response missing object data")
        return data

    def _task_from_payload(
        self,
        task_id: str,
        data: Mapping[str, object],
        *,
        default_state: str = "",
    ) -> RemoteParseTask:
        remote_state = (
            str(data.get("state") or data.get("status") or default_state)
            .strip()
            .lower()
        )
        state = self._map_state(remote_state)
        result_url = str(
            data.get("full_zip_url")
            or data.get("result_url")
            or data.get("zip_url")
            or ""
        ).strip()
        error_message = str(
            data.get("err_msg")
            or data.get("error_message")
            or data.get("message")
            or ""
        ).strip()
        error_code = str(data.get("err_code") or data.get("error_code") or "").strip()
        progress = {key: value for key, value in data.items()}
        progress["remote_state"] = remote_state
        return RemoteParseTask(
            task_id=task_id,
            state=state,
            result_url=result_url,
            error_code=error_code,
            error_message=error_message,
            progress=progress,
        )

    @staticmethod
    def _map_state(remote_state: str) -> ParserTaskState:
        if remote_state in {"pending", "waiting-file"}:
            return ParserTaskState.PENDING
        if remote_state in {"converting", "running"}:
            return ParserTaskState.RUNNING
        if remote_state == "done":
            return ParserTaskState.SUCCEEDED
        if remote_state == "failed":
            return ParserTaskState.FAILED
        raise MinerUError(f"unknown MinerU task state {remote_state!r}")

    def _model_version_for_source(self, source_name: str) -> str:
        if Path(source_name).suffix.lower() in {".html", ".htm"}:
            return "MinerU-HTML"
        return self._model_version
