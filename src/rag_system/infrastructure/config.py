from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from yaml.constructor import ConstructorError


CONFIG_SCHEMA_VERSION = 1
DEFAULT_CONFIG_PATH = Path("config/rag.yaml")
REDACTED = "<redacted>"
_PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ConfigurationError(ValueError):
    """Raised when the versioned RAG configuration cannot be loaded."""


class SecretValue:
    """A string that requires an explicit operation before it can be exposed."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("secret values must be strings")
        object.__setattr__(self, "_value", value)

    def __setattr__(self, _name: str, _value: object) -> None:
        raise AttributeError("SecretValue is immutable")

    def get_secret_value(self) -> str:
        return self._value

    def __bool__(self) -> bool:
        return bool(self._value)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({REDACTED!r})"

    def __str__(self) -> str:
        return REDACTED

    def __copy__(self) -> "SecretValue":
        return self

    def __deepcopy__(self, _memo: dict[int, object]) -> "SecretValue":
        return self


def _secret(value: str = "") -> SecretValue:
    return SecretValue(value)


@dataclass(frozen=True)
class StorageSettings:
    database_url: SecretValue = field(
        default_factory=lambda: _secret(
            "postgresql+asyncpg://rag:rag@localhost:5432/rag"
        )
    )
    elasticsearch_url: str = "http://localhost:9200"
    elasticsearch_api_key: SecretValue = field(default_factory=_secret)
    elasticsearch_username: str = ""
    elasticsearch_password: SecretValue = field(default_factory=_secret)
    elasticsearch_verify_certs: bool = True
    elasticsearch_index_prefix: str = "rag"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = ""
    s3_region: str = "us-east-1"
    s3_bucket: str = "my-rag"
    s3_access_key: SecretValue = field(default_factory=lambda: _secret("minioadmin"))
    s3_secret_key: SecretValue = field(default_factory=lambda: _secret("minioadmin"))
    s3_presign_expiry_seconds: int = 3600


@dataclass(frozen=True)
class ParserSettings:
    base_url: str = "https://mineru.net"
    api_token: SecretValue = field(default_factory=_secret)
    submission_mode: str = "url"
    model_version: str = "vlm"
    language: str = "ch"
    enable_ocr: bool = False
    poll_interval_seconds: float = 3.0
    max_wait_seconds: float = 1800.0
    request_timeout_seconds: float = 60.0
    max_result_bytes: int = 512 * 1024 * 1024


@dataclass(frozen=True)
class EmbeddingSettings:
    base_url: str = ""
    api_key: SecretValue = field(default_factory=_secret)
    model: str = "BAAI/bge-m3"
    dimensions: int = 1024
    send_dimensions: bool = False
    batch_size: int = 32


@dataclass(frozen=True)
class ChatSettings:
    base_url: str = ""
    api_key: SecretValue = field(default_factory=_secret)
    timeout_seconds: float = 60.0
    concurrency: int = 4


@dataclass(frozen=True)
class GenerationSettings:
    base_url: str = ""
    api_key: SecretValue = field(default_factory=_secret)
    model: str = ""
    timeout_seconds: float = 60.0
    concurrency: int = 4
    temperature: float = 0.0
    max_tokens: int = 1200
    prompt_version: str = "v1"


@dataclass(frozen=True)
class ChunkingSettings:
    max_tokens: int = 512
    overlap_tokens: int = 64


@dataclass(frozen=True)
class EnrichmentSettings:
    enabled: bool = True
    model: str = "deepseek-ai/DeepSeek-V4-Flash"
    keyword_top_n: int = 5
    question_top_n: int = 3
    prompt_version: str = "v1"


@dataclass(frozen=True)
class IndexingProfileSettings:
    id: str = "default-v1"
    chunking: ChunkingSettings = field(default_factory=ChunkingSettings)
    enrichment: EnrichmentSettings = field(default_factory=EnrichmentSettings)


@dataclass(frozen=True)
class RerankSettings:
    enabled: bool = False
    model: str = ""
    top_n: int = 50
    rrf_k: int = 60
    max_chunks_per_document: int = 0
    base_url: str = ""
    api_key: SecretValue = field(default_factory=_secret)
    timeout_seconds: float = 30.0


@dataclass(frozen=True)
class RetrievalProfileSettings:
    id: str = "hybrid-v1"
    top_k: int = 8
    candidate_k: int = 64
    num_candidates: int = 128
    score_threshold: float = 0.2
    term_weight: float = 0.7
    vector_weight: float = 0.3
    timezone: str = "Asia/Shanghai"
    relative_base: str = ""
    rerank: RerankSettings = field(default_factory=RerankSettings)


@dataclass(frozen=True)
class EvaluationProfileSettings:
    id: str = "ragas-core-v2"
    base_url: str = ""
    api_key: SecretValue = field(default_factory=_secret)
    model: str = ""
    timeout_seconds: float = 60.0
    concurrency: int = 2


@dataclass(frozen=True)
class WorkerSettings:
    id: str = "rag-worker"
    outbox_lease_seconds: int = 60
    outbox_poll_seconds: float = 1.0


@dataclass(frozen=True)
class McpSettings:
    host: str = "127.0.0.1"
    port: int = 8000
    bearer_token: SecretValue = field(default_factory=_secret)
    public_base_url: str = ""


@dataclass(frozen=True)
class Settings:
    schema_version: int = CONFIG_SCHEMA_VERSION
    config_path: str = str(DEFAULT_CONFIG_PATH)
    storage: StorageSettings = field(default_factory=StorageSettings)
    parser: ParserSettings = field(default_factory=ParserSettings)
    embedding: EmbeddingSettings = field(default_factory=EmbeddingSettings)
    chat: ChatSettings = field(default_factory=ChatSettings)
    generation: GenerationSettings = field(default_factory=GenerationSettings)
    indexing: IndexingProfileSettings = field(default_factory=IndexingProfileSettings)
    retrieval: RetrievalProfileSettings = field(
        default_factory=RetrievalProfileSettings
    )
    evaluation: EvaluationProfileSettings = field(
        default_factory=EvaluationProfileSettings
    )
    worker: WorkerSettings = field(default_factory=WorkerSettings)
    mcp: McpSettings = field(default_factory=McpSettings)

    @classmethod
    def from_env(
        cls,
        config_path: str | Path | None = None,
        *,
        environ: Mapping[str, str] | None = None,
    ) -> "Settings":
        env = os.environ if environ is None else environ
        configured_path = (
            config_path or env.get("RAG_CONFIG_PATH") or DEFAULT_CONFIG_PATH
        )
        path = Path(configured_path)
        raw = _load_yaml(path)

        indexing = _section(raw, "indexing_profile", "config")
        parser = _section(indexing, "parser", "indexing_profile")
        embedding = _section(indexing, "embedding", "indexing_profile")
        chunking = _section(indexing, "chunking", "indexing_profile")
        enrichment = _section(indexing, "enrichment", "indexing_profile")
        retrieval = _section(raw, "retrieval_profile", "config")
        generation = _section(raw, "generation", "config")
        evaluation = _section(raw, "evaluation_profile", "config")

        _exact_keys(
            raw,
            {
                "schema_version",
                "indexing_profile",
                "retrieval_profile",
                "generation",
                "evaluation_profile",
            },
            "config",
        )
        schema_version = _integer(raw, "schema_version", "config")
        if schema_version != CONFIG_SCHEMA_VERSION:
            raise ConfigurationError(
                f"config.schema_version must be {CONFIG_SCHEMA_VERSION}, "
                f"got {schema_version}"
            )

        _exact_keys(
            indexing,
            {"id", "parser", "embedding", "chunking", "enrichment"},
            "indexing_profile",
        )
        _exact_keys(
            parser,
            {"model_version", "language", "enable_ocr"},
            "indexing_profile.parser",
        )
        _exact_keys(
            embedding,
            {"model", "dimensions", "send_dimensions"},
            "indexing_profile.embedding",
        )
        _exact_keys(
            chunking,
            {"max_tokens", "overlap_tokens"},
            "indexing_profile.chunking",
        )
        _exact_keys(
            enrichment,
            {"enabled", "model", "keyword_top_n", "question_top_n", "prompt_version"},
            "indexing_profile.enrichment",
        )
        _exact_keys(
            retrieval,
            {
                "id",
                "top_k",
                "candidate_k",
                "num_candidates",
                "score_threshold",
                "term_weight",
                "vector_weight",
                "timezone",
                "rerank",
            },
            "retrieval_profile",
        )
        rerank = _section(retrieval, "rerank", "retrieval_profile")
        _exact_keys(
            rerank,
            {"enabled", "model", "top_n", "rrf_k", "max_chunks_per_document"},
            "retrieval_profile.rerank",
        )
        _exact_keys(
            generation,
            {"model", "temperature", "max_tokens", "prompt_version"},
            "generation",
        )
        _exact_keys(evaluation, {"id", "model"}, "evaluation_profile")

        settings = cls(
            schema_version=schema_version,
            config_path=str(path),
            storage=StorageSettings(
                database_url=_secret(
                    env.get(
                        "RAG_DATABASE_URL",
                        "postgresql+asyncpg://rag:rag@localhost:5432/rag",
                    )
                ),
                elasticsearch_url=env.get(
                    "RAG_ELASTICSEARCH_URL", "http://localhost:9200"
                ),
                elasticsearch_api_key=_secret(env.get("RAG_ELASTICSEARCH_API_KEY", "")),
                elasticsearch_username=env.get("RAG_ELASTICSEARCH_USERNAME", ""),
                elasticsearch_password=_secret(
                    env.get("RAG_ELASTICSEARCH_PASSWORD", "")
                ),
                elasticsearch_verify_certs=_bool_env(
                    env, "RAG_ELASTICSEARCH_VERIFY_CERTS", True
                ),
                elasticsearch_index_prefix=env.get(
                    "RAG_ELASTICSEARCH_INDEX_PREFIX", "rag"
                ),
                s3_endpoint_url=env.get("RAG_S3_ENDPOINT_URL", "http://localhost:9000"),
                s3_public_endpoint_url=env.get("RAG_S3_PUBLIC_ENDPOINT_URL", "").rstrip(
                    "/"
                ),
                s3_region=env.get("RAG_S3_REGION", "us-east-1"),
                s3_bucket=env.get("RAG_S3_BUCKET", "my-rag"),
                s3_access_key=_secret(env.get("RAG_S3_ACCESS_KEY", "minioadmin")),
                s3_secret_key=_secret(env.get("RAG_S3_SECRET_KEY", "minioadmin")),
                s3_presign_expiry_seconds=_int_env(
                    env, "RAG_S3_PRESIGN_EXPIRY_SECONDS", 3600
                ),
            ),
            parser=ParserSettings(
                base_url=env.get("RAG_MINERU_BASE_URL", "https://mineru.net").rstrip(
                    "/"
                ),
                api_token=_secret(env.get("RAG_MINERU_API_TOKEN", "")),
                submission_mode=env.get("RAG_MINERU_SUBMISSION_MODE", "url")
                .strip()
                .lower(),
                model_version=_string(
                    parser, "model_version", "indexing_profile.parser"
                ),
                language=_string(
                    parser,
                    "language",
                    "indexing_profile.parser",
                    allow_empty=True,
                ),
                enable_ocr=_boolean(parser, "enable_ocr", "indexing_profile.parser"),
                poll_interval_seconds=_float_env(
                    env, "RAG_MINERU_POLL_INTERVAL_SECONDS", 3.0
                ),
                max_wait_seconds=_float_env(env, "RAG_MINERU_MAX_WAIT_SECONDS", 1800.0),
                request_timeout_seconds=_float_env(
                    env, "RAG_MINERU_REQUEST_TIMEOUT_SECONDS", 60.0
                ),
                max_result_bytes=_int_env(
                    env, "RAG_MINERU_MAX_RESULT_BYTES", 512 * 1024 * 1024
                ),
            ),
            embedding=EmbeddingSettings(
                base_url=env.get("RAG_EMBEDDING_BASE_URL", "").rstrip("/"),
                api_key=_secret(env.get("RAG_EMBEDDING_API_KEY", "")),
                model=_string(embedding, "model", "indexing_profile.embedding"),
                dimensions=_integer(
                    embedding, "dimensions", "indexing_profile.embedding"
                ),
                send_dimensions=_boolean(
                    embedding, "send_dimensions", "indexing_profile.embedding"
                ),
                batch_size=_int_env(env, "RAG_EMBEDDING_BATCH_SIZE", 32),
            ),
            chat=ChatSettings(
                base_url=env.get("RAG_CHAT_BASE_URL", "").rstrip("/"),
                api_key=_secret(env.get("RAG_CHAT_API_KEY", "")),
                timeout_seconds=_float_env(env, "RAG_CHAT_TIMEOUT_SECONDS", 60.0),
                concurrency=_int_env(env, "RAG_CHAT_CONCURRENCY", 4),
            ),
            generation=GenerationSettings(
                base_url=env.get("RAG_GENERATION_BASE_URL", "").rstrip("/"),
                api_key=_secret(env.get("RAG_GENERATION_API_KEY", "")),
                model=_string(generation, "model", "generation", allow_empty=True),
                timeout_seconds=_float_env(env, "RAG_GENERATION_TIMEOUT_SECONDS", 60.0),
                concurrency=_int_env(env, "RAG_GENERATION_CONCURRENCY", 4),
                temperature=_number(generation, "temperature", "generation"),
                max_tokens=_integer(generation, "max_tokens", "generation"),
                prompt_version=_string(generation, "prompt_version", "generation"),
            ),
            indexing=IndexingProfileSettings(
                id=_string(indexing, "id", "indexing_profile"),
                chunking=ChunkingSettings(
                    max_tokens=_integer(
                        chunking, "max_tokens", "indexing_profile.chunking"
                    ),
                    overlap_tokens=_integer(
                        chunking, "overlap_tokens", "indexing_profile.chunking"
                    ),
                ),
                enrichment=EnrichmentSettings(
                    enabled=_boolean(
                        enrichment, "enabled", "indexing_profile.enrichment"
                    ),
                    model=_string(
                        enrichment,
                        "model",
                        "indexing_profile.enrichment",
                        allow_empty=True,
                    ),
                    keyword_top_n=_integer(
                        enrichment,
                        "keyword_top_n",
                        "indexing_profile.enrichment",
                    ),
                    question_top_n=_integer(
                        enrichment,
                        "question_top_n",
                        "indexing_profile.enrichment",
                    ),
                    prompt_version=_string(
                        enrichment,
                        "prompt_version",
                        "indexing_profile.enrichment",
                    ),
                ),
            ),
            retrieval=RetrievalProfileSettings(
                id=_string(retrieval, "id", "retrieval_profile"),
                top_k=_integer(retrieval, "top_k", "retrieval_profile"),
                candidate_k=_integer(retrieval, "candidate_k", "retrieval_profile"),
                num_candidates=_integer(
                    retrieval, "num_candidates", "retrieval_profile"
                ),
                score_threshold=_number(
                    retrieval, "score_threshold", "retrieval_profile"
                ),
                term_weight=_number(retrieval, "term_weight", "retrieval_profile"),
                vector_weight=_number(retrieval, "vector_weight", "retrieval_profile"),
                timezone=_string(retrieval, "timezone", "retrieval_profile"),
                relative_base=env.get("RAG_RELATIVE_BASE", ""),
                rerank=RerankSettings(
                    enabled=_boolean(rerank, "enabled", "retrieval_profile.rerank"),
                    model=_string(
                        rerank, "model", "retrieval_profile.rerank", allow_empty=True
                    ),
                    top_n=_integer(rerank, "top_n", "retrieval_profile.rerank"),
                    rrf_k=_integer(rerank, "rrf_k", "retrieval_profile.rerank"),
                    max_chunks_per_document=_integer(
                        rerank,
                        "max_chunks_per_document",
                        "retrieval_profile.rerank",
                    ),
                    base_url=env.get("RAG_RERANK_BASE_URL", "").rstrip("/"),
                    api_key=_secret(env.get("RAG_RERANK_API_KEY", "")),
                    timeout_seconds=_float_env(env, "RAG_RERANK_TIMEOUT_SECONDS", 30.0),
                ),
            ),
            evaluation=EvaluationProfileSettings(
                id=_string(evaluation, "id", "evaluation_profile"),
                base_url=env.get("RAG_EVAL_BASE_URL", "").rstrip("/"),
                api_key=_secret(env.get("RAG_EVAL_API_KEY", "")),
                model=_string(
                    evaluation, "model", "evaluation_profile", allow_empty=True
                ),
                timeout_seconds=_float_env(env, "RAG_EVAL_TIMEOUT_SECONDS", 60.0),
                concurrency=_int_env(env, "RAG_EVAL_CONCURRENCY", 2),
            ),
            worker=WorkerSettings(
                id=env.get("RAG_WORKER_ID", "rag-worker"),
                outbox_lease_seconds=_int_env(env, "RAG_OUTBOX_LEASE_SECONDS", 60),
                outbox_poll_seconds=_float_env(env, "RAG_OUTBOX_POLL_SECONDS", 1.0),
            ),
            mcp=McpSettings(
                host=env.get("RAG_MCP_HOST", "127.0.0.1"),
                port=_int_env(env, "RAG_MCP_PORT", 8000),
                bearer_token=_secret(env.get("RAG_MCP_BEARER_TOKEN", "")),
                public_base_url=env.get("RAG_MCP_PUBLIC_BASE_URL", "").rstrip("/"),
            ),
        )
        return settings.validate_effective()

    @property
    def chunks_index(self) -> str:
        return f"{self.storage.elasticsearch_index_prefix}-chunks-v2"

    @property
    def embedding_profile_id(self) -> str:
        return (
            f"openai-compatible:{self.embedding.model}:"
            f"{self.embedding.dimensions}:cosine:v1"
        )

    @property
    def enrichment_profile_id(self) -> str:
        enrichment = self.indexing.enrichment
        if not enrichment.enabled:
            return "disabled"
        material = ":".join(
            (
                enrichment.model,
                enrichment.prompt_version,
                str(enrichment.keyword_top_n),
                str(enrichment.question_top_n),
            )
        )
        return f"chat-enrichment:{sha256(material.encode()).hexdigest()[:16]}"

    @property
    def indexing_profile_fingerprint(self) -> str:
        return _fingerprint(self._indexing_profile_payload())

    @property
    def retrieval_profile_fingerprint(self) -> str:
        return _fingerprint(self._retrieval_profile_payload())

    @property
    def evaluation_profile_fingerprint(self) -> str:
        return _fingerprint(self._evaluation_profile_payload())

    def profile_metadata(self) -> dict[str, dict[str, str]]:
        return {
            "indexing": {
                "id": self.indexing.id,
                "fingerprint": self.indexing_profile_fingerprint,
            },
            "retrieval": {
                "id": self.retrieval.id,
                "fingerprint": self.retrieval_profile_fingerprint,
            },
            "evaluation": {
                "id": self.evaluation.id,
                "fingerprint": self.evaluation_profile_fingerprint,
            },
        }

    def to_redacted_dict(self) -> dict[str, Any]:
        result = _redacted_value(self)
        if not isinstance(result, dict):  # pragma: no cover - Settings is a dataclass
            raise TypeError("settings did not serialize to an object")
        result["profiles"] = self.profile_metadata()
        return result

    def validate_profiles(self) -> "Settings":
        if self.schema_version != CONFIG_SCHEMA_VERSION:
            raise ConfigurationError(f"schema_version must be {CONFIG_SCHEMA_VERSION}")
        _validate_profile_id("indexing_profile.id", self.indexing.id)
        _validate_profile_id("retrieval_profile.id", self.retrieval.id)
        _validate_profile_id("evaluation_profile.id", self.evaluation.id)
        self.validate_embedding_profile()
        self._validate_chunking_and_retrieval()

        if not self.parser.model_version:
            raise ConfigurationError(
                "indexing_profile.parser.model_version must be non-empty"
            )
        enrichment = self.indexing.enrichment
        if enrichment.enabled and not enrichment.model:
            raise ConfigurationError(
                "indexing_profile.enrichment.model is required when enrichment is enabled"
            )
        if not 1 <= enrichment.keyword_top_n <= 20:
            raise ConfigurationError(
                "indexing_profile.enrichment.keyword_top_n must be between 1 and 20"
            )
        if not 1 <= enrichment.question_top_n <= 20:
            raise ConfigurationError(
                "indexing_profile.enrichment.question_top_n must be between 1 and 20"
            )
        if not enrichment.prompt_version:
            raise ConfigurationError(
                "indexing_profile.enrichment.prompt_version must be non-empty"
            )
        if (
            not math.isfinite(self.generation.temperature)
            or not 0 <= self.generation.temperature <= 2
        ):
            raise ConfigurationError("generation.temperature must be between 0 and 2")
        if self.generation.max_tokens < 1:
            raise ConfigurationError("generation.max_tokens must be positive")
        if not self.generation.prompt_version:
            raise ConfigurationError("generation.prompt_version must be non-empty")
        try:
            ZoneInfo(self.retrieval.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ConfigurationError(
                f"retrieval_profile.timezone is unknown: {self.retrieval.timezone!r}"
            ) from exc
        return self

    def validate_effective(self) -> "Settings":
        self.validate_profiles().validate_storage()
        if self.storage.s3_presign_expiry_seconds < 1:
            raise ConfigurationError("RAG_S3_PRESIGN_EXPIRY_SECONDS must be positive")
        if self.parser.submission_mode not in {"url", "upload"}:
            raise ConfigurationError(
                "RAG_MINERU_SUBMISSION_MODE must be 'url' or 'upload'"
            )
        if (
            not math.isfinite(self.parser.poll_interval_seconds)
            or self.parser.poll_interval_seconds < 0
            or not _is_positive_finite(self.parser.max_wait_seconds)
            or not _is_positive_finite(self.parser.request_timeout_seconds)
            or self.parser.max_result_bytes < 1
        ):
            raise ConfigurationError(
                "MinerU polling, timeout, and size limits are invalid"
            )
        if self.embedding.batch_size < 1:
            raise ConfigurationError("RAG_EMBEDDING_BATCH_SIZE must be positive")
        if (
            not _is_positive_finite(self.chat.timeout_seconds)
            or self.chat.concurrency < 1
        ):
            raise ConfigurationError("chat timeout and concurrency must be positive")
        if (
            not _is_positive_finite(self.generation.timeout_seconds)
            or self.generation.concurrency < 1
        ):
            raise ConfigurationError(
                "generation timeout and concurrency must be positive"
            )
        if (
            not _is_positive_finite(self.evaluation.timeout_seconds)
            or self.evaluation.concurrency < 1
        ):
            raise ConfigurationError(
                "evaluation timeout and concurrency must be positive"
            )
        if not self.worker.id:
            raise ConfigurationError("RAG_WORKER_ID must be non-empty")
        if self.worker.outbox_lease_seconds < 1 or not _is_positive_finite(
            self.worker.outbox_poll_seconds
        ):
            raise ConfigurationError("outbox lease and poll intervals must be positive")
        if self.mcp.port < 1 or self.mcp.port > 65535:
            raise ConfigurationError("RAG_MCP_PORT must be between 1 and 65535")
        if not self.mcp.host:
            raise ConfigurationError("RAG_MCP_HOST must be non-empty")
        if self.retrieval.relative_base:
            try:
                datetime.fromisoformat(
                    self.retrieval.relative_base.replace("Z", "+00:00")
                )
            except ValueError as exc:
                raise ConfigurationError(
                    "RAG_RELATIVE_BASE must be an ISO-8601 datetime"
                ) from exc
        return self

    def validate(self) -> "Settings":
        return (
            self.validate_profiles()
            .validate_storage()
            .validate_parser()
            .validate_embedding()
            .validate_enrichment()
            .validate_retrieval()
        )

    def validate_storage(self) -> "Settings":
        if not self.storage.elasticsearch_url:
            raise ValueError("RAG_ELASTICSEARCH_URL is required")
        if not self.storage.database_url:
            raise ValueError("RAG_DATABASE_URL is required")
        if not self.storage.s3_bucket:
            raise ValueError("RAG_S3_BUCKET is required")
        return self

    def validate_chat(self) -> "Settings":
        if (
            not self.chat.base_url
            or not self.chat.api_key
            or not self.indexing.enrichment.model
        ):
            raise ValueError(
                "RAG_CHAT_BASE_URL, RAG_CHAT_API_KEY, and "
                "indexing_profile.enrichment.model are required"
            )
        if (
            not _is_positive_finite(self.chat.timeout_seconds)
            or self.chat.concurrency < 1
        ):
            raise ValueError("chat timeout and concurrency must be positive")
        return self

    def validate_generation(self) -> "Settings":
        generation = self.generation
        if not generation.base_url or not generation.api_key or not generation.model:
            raise ValueError(
                "RAG_GENERATION_BASE_URL, RAG_GENERATION_API_KEY, and "
                "generation.model are required"
            )
        if (
            not _is_positive_finite(generation.timeout_seconds)
            or generation.concurrency < 1
            or generation.max_tokens < 1
        ):
            raise ValueError(
                "generation timeout, concurrency, and max tokens must be positive"
            )
        if not 0 <= generation.temperature <= 2:
            raise ValueError("generation temperature must be between 0 and 2")
        if not generation.prompt_version:
            raise ValueError("generation.prompt_version is required")
        return self

    def validate_enrichment(self) -> "Settings":
        enrichment = self.indexing.enrichment
        if not enrichment.enabled:
            return self
        self.validate_chat()
        if not 1 <= enrichment.keyword_top_n <= 20:
            raise ValueError("enrichment keyword top_n must be between 1 and 20")
        if not 1 <= enrichment.question_top_n <= 20:
            raise ValueError("enrichment question top_n must be between 1 and 20")
        if not enrichment.prompt_version:
            raise ValueError("indexing_profile.enrichment.prompt_version is required")
        return self

    def validate_evaluation(self) -> "Settings":
        evaluation = self.evaluation
        if not evaluation.base_url or not evaluation.api_key or not evaluation.model:
            raise ValueError(
                "RAG_EVAL_BASE_URL, RAG_EVAL_API_KEY, and "
                "evaluation_profile.model are required"
            )
        if (
            not _is_positive_finite(evaluation.timeout_seconds)
            or evaluation.concurrency < 1
        ):
            raise ValueError("evaluation timeout and concurrency must be positive")
        return self

    def validate_parser(self) -> "Settings":
        if not self.parser.api_token:
            raise ValueError("RAG_MINERU_API_TOKEN is required")
        if self.parser.submission_mode not in {"url", "upload"}:
            raise ValueError("RAG_MINERU_SUBMISSION_MODE must be 'url' or 'upload'")
        if (
            not math.isfinite(self.parser.poll_interval_seconds)
            or self.parser.poll_interval_seconds < 0
            or not _is_positive_finite(self.parser.max_wait_seconds)
            or not _is_positive_finite(self.parser.request_timeout_seconds)
            or self.parser.max_result_bytes < 1
        ):
            raise ValueError("MinerU polling, timeout, and size limits are invalid")
        if self.parser.submission_mode == "upload":
            return self
        presign_endpoint = (
            self.storage.s3_public_endpoint_url or self.storage.s3_endpoint_url
        )
        if presign_endpoint and not _is_http_url(presign_endpoint):
            raise ValueError("the S3 presign endpoint must be an HTTP(S) URL")
        if _is_loopback_endpoint(presign_endpoint):
            raise ValueError(
                "RAG_S3_PUBLIC_ENDPOINT_URL must be reachable by remote MinerU; "
                "the configured presign endpoint is local"
            )
        return self

    def validate_embedding(self) -> "Settings":
        self.validate_embedding_profile()
        if self.embedding.batch_size < 1:
            raise ValueError("embedding batch size must be positive")
        if not self.embedding.base_url or not self.embedding.api_key:
            raise ValueError("cloud embedding base URL and API key are required")
        return self

    def validate_embedding_profile(self) -> "Settings":
        if not self.embedding.model:
            raise ConfigurationError(
                "indexing_profile.embedding.model is required before creating indexes"
            )
        if self.embedding.dimensions < 1:
            raise ConfigurationError("embedding dimensions must be positive")
        return self

    def validate_retrieval(self) -> "Settings":
        self._validate_chunking_and_retrieval()
        if self.worker.outbox_lease_seconds < 1 or not _is_positive_finite(
            self.worker.outbox_poll_seconds
        ):
            raise ValueError("outbox lease and poll intervals must be positive")
        return self

    def validate_mcp(self, transport: str) -> "Settings":
        if transport not in {"stdio", "streamable-http"}:
            raise ValueError("MCP transport must be 'stdio' or 'streamable-http'")
        if self.mcp.port < 1 or self.mcp.port > 65535:
            raise ValueError("RAG_MCP_PORT must be between 1 and 65535")
        if transport == "streamable-http" and self.mcp.host not in {
            "127.0.0.1",
            "localhost",
            "::1",
        }:
            if not self.mcp.bearer_token:
                raise ValueError(
                    "a bearer token is required when MCP binds outside loopback"
                )
            if not self.mcp.public_base_url:
                raise ValueError(
                    "RAG_MCP_PUBLIC_BASE_URL is required when MCP binds outside loopback"
                )
            if not _is_https_url(
                self.mcp.public_base_url
            ) and not _is_loopback_http_url(self.mcp.public_base_url):
                raise ValueError(
                    "RAG_MCP_PUBLIC_BASE_URL must be an HTTPS URL or a loopback HTTP URL"
                )
        return self

    def _validate_chunking_and_retrieval(self) -> None:
        chunking = self.indexing.chunking
        retrieval = self.retrieval
        if chunking.max_tokens < 32:
            raise ConfigurationError(
                "indexing_profile.chunking.max_tokens must be at least 32"
            )
        if not 0 <= chunking.overlap_tokens < chunking.max_tokens:
            raise ConfigurationError(
                "indexing_profile.chunking.overlap_tokens must be smaller than max_tokens"
            )
        if not 1 <= retrieval.top_k <= 20:
            raise ConfigurationError("retrieval_profile.top_k must be between 1 and 20")
        if retrieval.candidate_k < retrieval.top_k:
            raise ConfigurationError(
                "retrieval_profile.candidate_k must be at least top_k"
            )
        if retrieval.num_candidates < retrieval.candidate_k:
            raise ConfigurationError(
                "retrieval_profile.num_candidates must be at least candidate_k"
            )
        if (
            not math.isfinite(retrieval.score_threshold)
            or not 0 <= retrieval.score_threshold <= 1
        ):
            raise ConfigurationError(
                "retrieval_profile.score_threshold must be between 0 and 1"
            )
        if (
            not math.isfinite(retrieval.term_weight)
            or not math.isfinite(retrieval.vector_weight)
            or retrieval.term_weight < 0
            or retrieval.vector_weight < 0
        ):
            raise ConfigurationError("retrieval profile weights cannot be negative")
        if abs(retrieval.term_weight + retrieval.vector_weight - 1.0) > 1e-9:
            raise ConfigurationError(
                "retrieval_profile term_weight and vector_weight must sum to 1"
            )
        rerank = retrieval.rerank
        if rerank.top_n < 1:
            raise ConfigurationError("retrieval_profile.rerank.top_n must be positive")
        if rerank.rrf_k < 1:
            raise ConfigurationError("retrieval_profile.rerank.rrf_k must be positive")
        if rerank.max_chunks_per_document < 0:
            raise ConfigurationError(
                "retrieval_profile.rerank.max_chunks_per_document cannot be negative"
            )
        if rerank.enabled and not rerank.model:
            raise ConfigurationError(
                "retrieval_profile.rerank.model is required when rerank is enabled"
            )
        if rerank.enabled and (not rerank.base_url or not rerank.api_key):
            raise ConfigurationError(
                "RAG_RERANK_BASE_URL and RAG_RERANK_API_KEY are required when "
                "retrieval_profile.rerank is enabled"
            )

    def _indexing_profile_payload(self) -> dict[str, Any]:
        return {
            "id": self.indexing.id,
            "parser": {
                "model_version": self.parser.model_version,
                "language": self.parser.language,
                "enable_ocr": self.parser.enable_ocr,
            },
            "embedding": {
                "model": self.embedding.model,
                "dimensions": self.embedding.dimensions,
                "send_dimensions": self.embedding.send_dimensions,
            },
            "chunking": _plain_dataclass(self.indexing.chunking),
            "enrichment": _plain_dataclass(self.indexing.enrichment),
        }

    def _retrieval_profile_payload(self) -> dict[str, Any]:
        return {
            "id": self.retrieval.id,
            "top_k": self.retrieval.top_k,
            "candidate_k": self.retrieval.candidate_k,
            "num_candidates": self.retrieval.num_candidates,
            "score_threshold": self.retrieval.score_threshold,
            "term_weight": self.retrieval.term_weight,
            "vector_weight": self.retrieval.vector_weight,
            "timezone": self.retrieval.timezone,
            "rerank": {
                "enabled": self.retrieval.rerank.enabled,
                "model": self.retrieval.rerank.model,
                "top_n": self.retrieval.rerank.top_n,
                "rrf_k": self.retrieval.rerank.rrf_k,
                "max_chunks_per_document": (
                    self.retrieval.rerank.max_chunks_per_document
                ),
            },
        }

    def _evaluation_profile_payload(self) -> dict[str, Any]:
        return {"id": self.evaluation.id, "model": self.evaluation.model}


class _UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_unique_mapping(
    loader: _UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False
) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found an unhashable key",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ConfigurationError(f"RAG config file not found: {path}") from exc
    except OSError as exc:
        raise ConfigurationError(f"cannot read RAG config file {path}: {exc}") from exc
    try:
        value = yaml.load(content, Loader=_UniqueKeyLoader)
    except yaml.YAMLError as exc:
        problem = getattr(exc, "problem", None) or "syntax error"
        mark = getattr(exc, "problem_mark", None)
        location = (
            f" at line {mark.line + 1}, column {mark.column + 1}"
            if mark is not None
            else ""
        )
        raise ConfigurationError(
            f"invalid YAML in {path}: {problem}{location}"
        ) from exc
    return _mapping(value, "config")


def _mapping(value: object, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigurationError(f"{path} must be a mapping")
    if any(not isinstance(key, str) for key in value):
        raise ConfigurationError(f"{path} keys must be strings")
    return value


def _section(parent: dict[str, Any], key: str, path: str) -> dict[str, Any]:
    if key not in parent:
        raise ConfigurationError(f"{path}.{key} is required")
    return _mapping(parent[key], f"{path}.{key}")


def _exact_keys(value: dict[str, Any], expected: set[str], path: str) -> None:
    unknown = set(value) - expected
    missing = expected - set(value)
    if unknown:
        raise ConfigurationError(
            f"{path} has unknown fields: {', '.join(sorted(unknown))}"
        )
    if missing:
        raise ConfigurationError(
            f"{path} is missing fields: {', '.join(sorted(missing))}"
        )


def _string(
    value: dict[str, Any], key: str, path: str, *, allow_empty: bool = False
) -> str:
    parsed = value.get(key)
    if not isinstance(parsed, str):
        raise ConfigurationError(f"{path}.{key} must be a string")
    parsed = parsed.strip()
    if not parsed and not allow_empty:
        raise ConfigurationError(f"{path}.{key} must be non-empty")
    return parsed


def _integer(value: dict[str, Any], key: str, path: str) -> int:
    parsed = value.get(key)
    if isinstance(parsed, bool) or not isinstance(parsed, int):
        raise ConfigurationError(f"{path}.{key} must be an integer")
    return parsed


def _number(value: dict[str, Any], key: str, path: str) -> float:
    parsed = value.get(key)
    if isinstance(parsed, bool) or not isinstance(parsed, (int, float)):
        raise ConfigurationError(f"{path}.{key} must be a number")
    return float(parsed)


def _boolean(value: dict[str, Any], key: str, path: str) -> bool:
    parsed = value.get(key)
    if not isinstance(parsed, bool):
        raise ConfigurationError(f"{path}.{key} must be a boolean")
    return parsed


def _int_env(env: Mapping[str, str], name: str, default: int) -> int:
    value = env.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc


def _float_env(env: Mapping[str, str], name: str, default: float) -> float:
    value = env.get(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number") from exc


def _bool_env(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be a boolean")


def _validate_profile_id(path: str, value: str) -> None:
    if not _PROFILE_ID.fullmatch(value):
        raise ConfigurationError(
            f"{path} must match {_PROFILE_ID.pattern!r}, got {value!r}"
        )


def _plain_dataclass(value: object) -> dict[str, Any]:
    return {item.name: getattr(value, item.name) for item in fields(value)}


def _fingerprint(value: dict[str, Any]) -> str:
    material = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256(material).hexdigest()


def _is_positive_finite(value: float) -> bool:
    return math.isfinite(value) and value > 0


def _redacted_value(value: object) -> Any:
    if isinstance(value, SecretValue):
        return REDACTED
    if is_dataclass(value) and not isinstance(value, type):
        return {
            item.name: _redacted_value(getattr(value, item.name))
            for item in fields(value)
        }
    if isinstance(value, tuple):
        return [_redacted_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _redacted_value(item) for key, item in value.items()}
    return value


def _is_loopback_endpoint(endpoint: str) -> bool:
    if not endpoint:
        return False
    hostname = urlsplit(endpoint).hostname
    return hostname in {"localhost", "127.0.0.1", "::1", "0.0.0.0", "minio"}


def _is_http_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname)


def _is_https_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.hostname)


def _is_loopback_http_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme == "http" and parsed.hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }
