from __future__ import annotations

from dataclasses import asdict, replace
import json
from pathlib import Path

import pytest
import yaml

from rag_system.application.runtime import build_retrieval_runtime
from rag_system.infrastructure.config import (
    ChatSettings,
    ConfigurationError,
    EvaluationProfileSettings,
    GenerationSettings,
    McpSettings,
    ParserSettings,
    REDACTED,
    SecretValue,
    Settings,
)
from rag_system.interfaces.cli import main


def _secret(value: str) -> SecretValue:
    return SecretValue(value)


def _config_data() -> dict:
    return yaml.safe_load(Path("config/rag.yaml").read_text(encoding="utf-8"))


def _write_config(tmp_path: Path, value: dict, name: str = "rag.yaml") -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(value, sort_keys=False), encoding="utf-8")
    return path


def test_parser_requires_remote_reachable_presign_endpoint() -> None:
    local = Settings(
        parser=replace(Settings().parser, api_token=_secret("token")),
    )
    with pytest.raises(ValueError, match="reachable by remote MinerU"):
        local.validate_parser()

    remote = replace(
        local,
        storage=replace(
            local.storage,
            s3_public_endpoint_url="https://objects.example.com",
        ),
    )
    assert remote.validate_parser() is remote

    invalid = replace(
        local,
        storage=replace(
            local.storage,
            s3_public_endpoint_url="objects.example.com",
        ),
    )
    with pytest.raises(ValueError, match=r"HTTP\(S\) URL"):
        invalid.validate_parser()


def test_upload_mode_skips_public_endpoint_check() -> None:
    upload = Settings(
        parser=ParserSettings(
            api_token=_secret("token"),
            submission_mode="upload",
        )
    )
    assert upload.validate_parser() is upload

    unknown = replace(
        upload,
        parser=replace(upload.parser, submission_mode="push"),
    )
    with pytest.raises(ValueError, match="RAG_MINERU_SUBMISSION_MODE"):
        unknown.validate_parser()


def test_stdio_does_not_require_http_bearer_token() -> None:
    settings = Settings(mcp=McpSettings(host="0.0.0.0"))

    assert settings.validate_mcp("stdio") is settings
    with pytest.raises(ValueError, match="bearer token"):
        settings.validate_mcp("streamable-http")

    authenticated = replace(
        settings,
        mcp=McpSettings(
            host="0.0.0.0",
            bearer_token=_secret("secret"),
            public_base_url="https://rag.example.com",
        ),
    )
    assert authenticated.validate_mcp("streamable-http") is authenticated

    local_authenticated = replace(
        authenticated,
        mcp=replace(
            authenticated.mcp,
            public_base_url="http://127.0.0.1:18080",
        ),
    )
    assert local_authenticated.validate_mcp("streamable-http") is local_authenticated

    insecure = replace(
        authenticated,
        mcp=replace(
            authenticated.mcp,
            public_base_url="http://rag.example.com",
        ),
    )
    with pytest.raises(ValueError, match="HTTPS URL"):
        insecure.validate_mcp("streamable-http")


def test_enrichment_configuration_is_required_only_when_enabled() -> None:
    settings = Settings()
    disabled = replace(
        settings,
        indexing=replace(
            settings.indexing,
            enrichment=replace(settings.indexing.enrichment, enabled=False),
        ),
    )
    assert disabled.validate_enrichment() is disabled

    with pytest.raises(ValueError, match="RAG_CHAT_BASE_URL"):
        settings.validate_enrichment()


def test_enrichment_profile_changes_when_model_prompt_or_counts_change() -> None:
    first = Settings(
        chat=ChatSettings(
            base_url="https://chat.example/v1",
            api_key=_secret("key"),
        )
    )
    changed_model = replace(
        first,
        indexing=replace(
            first.indexing,
            enrichment=replace(first.indexing.enrichment, model="model-b"),
        ),
    )
    changed_prompt = replace(
        first,
        indexing=replace(
            first.indexing,
            enrichment=replace(first.indexing.enrichment, prompt_version="v2"),
        ),
    )
    changed_count = replace(
        first,
        indexing=replace(
            first.indexing,
            enrichment=replace(first.indexing.enrichment, keyword_top_n=6),
        ),
    )
    assert (
        len(
            {
                first.enrichment_profile_id,
                changed_model.enrichment_profile_id,
                changed_prompt.enrichment_profile_id,
                changed_count.enrichment_profile_id,
            }
        )
        == 4
    )


def test_ragas_evaluation_uses_independent_configuration() -> None:
    settings = Settings(
        evaluation=EvaluationProfileSettings(
            base_url="https://judge.example/v1",
            api_key=_secret("key"),
            model="judge-model",
        )
    )
    assert settings.validate_evaluation() is settings

    with pytest.raises(ValueError, match="RAG_EVAL_BASE_URL"):
        Settings(
            chat=ChatSettings(
                base_url="https://chat.example/v1",
                api_key=_secret("key"),
            )
        ).validate_evaluation()

    invalid = replace(
        settings,
        evaluation=replace(settings.evaluation, concurrency=0),
    )
    with pytest.raises(ValueError, match="timeout and concurrency"):
        invalid.validate_evaluation()


def test_generation_configuration_is_required_and_independent_from_chat() -> None:
    settings = Settings(
        generation=GenerationSettings(
            base_url="https://generation.example/v1",
            api_key=_secret("key"),
            model="answer-model",
        )
    )
    assert settings.validate_generation() is settings

    with pytest.raises(ValueError, match="RAG_GENERATION_BASE_URL"):
        Settings(
            chat=ChatSettings(
                base_url="https://chat.example/v1",
                api_key=_secret("key"),
            )
        ).validate_generation()

    invalid_temperature = replace(
        settings,
        generation=replace(settings.generation, temperature=2.1),
    )
    with pytest.raises(ValueError, match="temperature"):
        invalid_temperature.validate_generation()

    invalid_tokens = replace(
        settings,
        generation=replace(settings.generation, max_tokens=0),
    )
    with pytest.raises(ValueError, match="max tokens"):
        invalid_tokens.validate_generation()


def test_yaml_profile_changes_only_the_corresponding_fingerprint(tmp_path) -> None:
    original_path = _write_config(tmp_path, _config_data(), "original.yaml")
    original = Settings.from_env(original_path, environ={})

    cases = (
        ("indexing", ("indexing_profile", "chunking", "max_tokens"), 640),
        ("retrieval", ("retrieval_profile", "top_k"), 7),
        ("retrieval", ("retrieval_profile", "rerank", "rrf_k"), 70),
        ("evaluation", ("evaluation_profile", "model"), "judge-model"),
    )
    for expected_profile, key_path, replacement_value in cases:
        value = _config_data()
        target = value
        for key in key_path[:-1]:
            target = target[key]
        target[key_path[-1]] = replacement_value
        changed = Settings.from_env(
            _write_config(tmp_path, value, f"{expected_profile}.yaml"),
            environ={},
        )

        original_profiles = original.profile_metadata()
        changed_profiles = changed.profile_metadata()
        for profile_name in original_profiles:
            if profile_name == expected_profile:
                assert (
                    changed_profiles[profile_name]["fingerprint"]
                    != original_profiles[profile_name]["fingerprint"]
                )
            else:
                assert (
                    changed_profiles[profile_name]["fingerprint"]
                    == original_profiles[profile_name]["fingerprint"]
                )


def test_legacy_profile_environment_variables_do_not_override_yaml(tmp_path) -> None:
    path = _write_config(tmp_path, _config_data())

    settings = Settings.from_env(
        path,
        environ={
            "RAG_EMBEDDING_MODEL": "legacy-model",
            "RAG_CHAT_MODEL": "legacy-chat",
            "RAG_RETRIEVAL_TOP_K": "1",
        },
    )

    assert settings.embedding.model == "BAAI/bge-m3"
    assert settings.indexing.enrichment.model == "deepseek-ai/DeepSeek-V4-Flash"
    assert settings.retrieval.top_k == 8


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda value: value.update({"typo": True}), "unknown fields: typo"),
        (
            lambda value: value.pop("retrieval_profile"),
            "config.retrieval_profile is required",
        ),
        (
            lambda value: value["retrieval_profile"].update({"term_weight": 0.8}),
            "must sum to 1",
        ),
        (
            lambda value: value["retrieval_profile"]["rerank"].update(
                {"enabled": True}
            ),
            "rerank.model is required",
        ),
        (
            lambda value: value["retrieval_profile"]["rerank"].update({"rrf_k": 0}),
            "rrf_k must be positive",
        ),
        (
            lambda value: value["retrieval_profile"]["rerank"].update(
                {"enabled": True, "model": "BAAI/bge-reranker-v2-m3"}
            ),
            "RAG_RERANK_BASE_URL",
        ),
    ],
)
def test_yaml_rejects_unknown_missing_and_invalid_values(
    tmp_path, mutate, message
) -> None:
    value = _config_data()
    mutate(value)
    path = _write_config(tmp_path, value)

    with pytest.raises(ConfigurationError, match=message):
        Settings.from_env(path, environ={})


def test_yaml_rejects_duplicate_keys_and_missing_files(tmp_path) -> None:
    duplicate = tmp_path / "duplicate.yaml"
    duplicate.write_text(
        Path("config/rag.yaml").read_text(encoding="utf-8") + "\nschema_version: 1\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError, match="duplicate key 'schema_version'"):
        Settings.from_env(duplicate, environ={})

    with pytest.raises(ConfigurationError, match="config file not found"):
        Settings.from_env(tmp_path / "missing.yaml", environ={})


def test_invalid_yaml_fails_before_runtime_clients_are_constructed(
    tmp_path, monkeypatch
) -> None:
    value = _config_data()
    value["retrieval_profile"]["candidate_k"] = 1
    path = _write_config(tmp_path, value)
    monkeypatch.setenv("RAG_CONFIG_PATH", str(path))

    def unexpected_client(_settings):  # pragma: no cover - must not be called
        raise AssertionError("client construction must not run")

    monkeypatch.setattr(
        "rag_system.application.runtime.PostgresRepository.from_settings",
        unexpected_client,
    )
    with pytest.raises(ConfigurationError, match="candidate_k"):
        build_retrieval_runtime()


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("RAG_CHAT_CONCURRENCY", "0", "chat timeout and concurrency"),
        ("RAG_EVAL_TIMEOUT_SECONDS", "nan", "evaluation timeout and concurrency"),
        ("RAG_MCP_PORT", "70000", "RAG_MCP_PORT"),
        ("RAG_RELATIVE_BASE", "not-a-date", "RAG_RELATIVE_BASE"),
    ],
)
def test_invalid_deployment_values_fail_during_config_loading(
    tmp_path, name, value, message
) -> None:
    path = _write_config(tmp_path, _config_data())

    with pytest.raises(ConfigurationError, match=message):
        Settings.from_env(path, environ={name: value})


def test_repr_asdict_and_config_show_never_expose_secrets(
    tmp_path, monkeypatch, capsys
) -> None:
    path = _write_config(tmp_path, _config_data())
    secrets = {
        "RAG_DATABASE_URL": "postgresql+asyncpg://user:db-marker@example/rag",
        "RAG_ELASTICSEARCH_API_KEY": "es-marker",
        "RAG_ELASTICSEARCH_PASSWORD": "es-password-marker",
        "RAG_S3_ACCESS_KEY": "s3-access-marker",
        "RAG_S3_SECRET_KEY": "s3-secret-marker",
        "RAG_MINERU_API_TOKEN": "mineru-marker",
        "RAG_EMBEDDING_API_KEY": "embedding-marker",
        "RAG_CHAT_API_KEY": "chat-marker",
        "RAG_GENERATION_API_KEY": "generation-marker",
        "RAG_EVAL_API_KEY": "eval-marker",
        "RAG_MCP_BEARER_TOKEN": "mcp-marker",
    }
    settings = Settings.from_env(path, environ=secrets)
    rendered = "\n".join(
        (
            repr(settings),
            repr(asdict(settings)),
            json.dumps(settings.to_redacted_dict()),
        )
    )
    assert REDACTED in rendered
    assert not any(secret in rendered for secret in secrets.values())

    for name, secret in secrets.items():
        monkeypatch.setenv(name, secret)
    main(["--config", str(path), "config", "show"])
    output = capsys.readouterr().out
    assert REDACTED in output
    assert not any(secret in output for secret in secrets.values())


def test_config_validate_reports_profile_ids_and_fingerprints(tmp_path, capsys) -> None:
    path = _write_config(tmp_path, _config_data())

    main(["--config", str(path), "config", "validate"])

    output = json.loads(capsys.readouterr().out)
    assert output["status"] == "valid"
    assert output["schema_version"] == 1
    assert output["profiles"]["indexing"]["id"] == "default-v1"
    assert len(output["profiles"]["retrieval"]["fingerprint"]) == 64
