from __future__ import annotations

import asyncio
from io import BytesIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings


class S3ObjectStore:
    """Async wrapper around a boto3 S3 client."""

    def __init__(
        self, *, bucket: str, client: object, presign_client: object | None = None
    ) -> None:
        if not bucket:
            raise ValueError("bucket is required")
        self._bucket = bucket
        self._client = client
        self._presign_client = presign_client or client

    @classmethod
    def from_settings(cls, settings: Settings) -> "S3ObjectStore":
        storage = settings.storage
        session = boto3.session.Session()
        client = session.client(
            "s3",
            endpoint_url=storage.s3_endpoint_url or None,
            region_name=storage.s3_region,
            aws_access_key_id=storage.s3_access_key.get_secret_value(),
            aws_secret_access_key=storage.s3_secret_key.get_secret_value(),
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
            ),
        )
        public_endpoint_url = storage.s3_public_endpoint_url
        presign_client = client
        if public_endpoint_url:
            presign_client = session.client(
                "s3",
                endpoint_url=public_endpoint_url,
                region_name=storage.s3_region,
                aws_access_key_id=storage.s3_access_key.get_secret_value(),
                aws_secret_access_key=storage.s3_secret_key.get_secret_value(),
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                ),
            )
        return cls(
            bucket=storage.s3_bucket, client=client, presign_client=presign_client
        )

    async def put_bytes(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> None:
        body = BytesIO(data)
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            Metadata=metadata or {},
        )

    async def get_bytes(self, key: str) -> bytes:
        response = await asyncio.to_thread(
            self._client.get_object,
            Bucket=self._bucket,
            Key=key,
        )
        body = response["Body"]
        return await asyncio.to_thread(body.read)

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(
                self._client.head_object,
                Bucket=self._bucket,
                Key=key,
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    async def presign_get(self, key: str, expires_in: int) -> str:
        if expires_in < 1:
            raise ValueError("expires_in must be positive")
        return await asyncio.to_thread(
            self._presign_client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    async def ensure_bucket(self) -> None:
        try:
            await asyncio.to_thread(self._client.head_bucket, Bucket=self._bucket)
            return
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code not in {"404", "NoSuchBucket", "NotFound"}:
                raise
        await asyncio.to_thread(self._client.create_bucket, Bucket=self._bucket)
