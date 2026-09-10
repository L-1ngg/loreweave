from __future__ import annotations

from io import BytesIO

import pytest
from botocore.exceptions import ClientError

from rag_system.infrastructure.config import SecretValue, Settings, StorageSettings
from rag_system.infrastructure.object_store import S3ObjectStore


class FakeS3Client:
    def __init__(self, *, base_url: str = "https://signed.example.com") -> None:
        self.objects: dict[str, bytes] = {}
        self.presigned: list[tuple[str, dict[str, str], int]] = []
        self.base_url = base_url

    def put_object(
        self,
        *,
        Bucket: str,
        Key: str,
        Body: BytesIO,
        ContentType: str,
        Metadata: dict[str, str],
    ) -> None:
        assert Bucket == "test-bucket"
        assert ContentType == "application/pdf"
        assert Metadata == {"sha256": "abc"}
        self.objects[Key] = Body.read()

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, BytesIO]:
        assert Bucket == "test-bucket"
        return {"Body": BytesIO(self.objects[Key])}

    def head_object(self, *, Bucket: str, Key: str) -> None:
        assert Bucket == "test-bucket"
        if Key not in self.objects:
            raise ClientError(
                {"Error": {"Code": "404", "Message": "missing"}},
                "HeadObject",
            )

    def generate_presigned_url(
        self, operation: str, *, Params: dict[str, str], ExpiresIn: int
    ) -> str:
        self.presigned.append((operation, Params, ExpiresIn))
        return f"{self.base_url}/{Params['Key']}?expires={ExpiresIn}"


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.clients: list[FakeS3Client] = []

    def client(self, service_name: str, **kwargs) -> FakeS3Client:
        assert service_name == "s3"
        self.calls.append(kwargs)
        client = FakeS3Client(base_url=str(kwargs["endpoint_url"]).rstrip("/"))
        self.clients.append(client)
        return client


@pytest.mark.asyncio
async def test_put_get_and_exists_round_trip() -> None:
    store = S3ObjectStore(bucket="test-bucket", client=FakeS3Client())

    await store.put_bytes(
        "documents/source.pdf",
        b"pdf-bytes",
        content_type="application/pdf",
        metadata={"sha256": "abc"},
    )

    assert await store.exists("documents/source.pdf") is True
    assert await store.get_bytes("documents/source.pdf") == b"pdf-bytes"
    assert await store.exists("documents/missing.pdf") is False


@pytest.mark.asyncio
async def test_presign_get_uses_bucket_and_expiry() -> None:
    client = FakeS3Client()
    store = S3ObjectStore(bucket="test-bucket", client=client)

    url = await store.presign_get("parsed/result.zip", expires_in=900)

    assert url == "https://signed.example.com/parsed/result.zip?expires=900"
    assert client.presigned == [
        ("get_object", {"Bucket": "test-bucket", "Key": "parsed/result.zip"}, 900)
    ]


@pytest.mark.asyncio
async def test_from_settings_uses_public_endpoint_for_presign(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_session = FakeSession()
    monkeypatch.setattr(
        "rag_system.infrastructure.object_store.boto3.session.Session",
        lambda: fake_session,
    )
    settings = Settings(
        storage=StorageSettings(
            elasticsearch_url="http://localhost:9200",
            s3_endpoint_url="http://minio:9000",
            s3_public_endpoint_url="https://public-s3.example.com",
            s3_region="us-east-1",
            s3_bucket="test-bucket",
            s3_access_key=SecretValue("key"),
            s3_secret_key=SecretValue("secret"),
        )
    )

    store = S3ObjectStore.from_settings(settings)

    assert fake_session.calls[0]["endpoint_url"] == "http://minio:9000"
    assert fake_session.calls[1]["endpoint_url"] == "https://public-s3.example.com"
    assert store._presign_client is fake_session.clients[1]
    assert store._client is fake_session.clients[0]
    url = await store.presign_get("parsed/result.zip", expires_in=60)
    assert url == "https://public-s3.example.com/parsed/result.zip?expires=60"
    assert fake_session.clients[0].presigned == []
    assert fake_session.clients[1].presigned == [
        ("get_object", {"Bucket": "test-bucket", "Key": "parsed/result.zip"}, 60)
    ]
