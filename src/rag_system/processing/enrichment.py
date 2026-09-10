from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from hashlib import sha256
import re
from typing import Any

from ..domain.lexical import lexical_fields
from ..domain.models import (
    Chunk,
    EnrichmentProvenance,
    EnrichmentStatus,
)
from ..domain.ports import ChatProvider, EnrichmentCache
from .chunking import retrieval_text_for_chunk


ENRICHMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "keywords": {"type": "array", "items": {"type": "string"}},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["keywords", "questions"],
}


@dataclass(frozen=True)
class EnrichmentOptions:
    enabled: bool
    keyword_top_n: int
    question_top_n: int
    prompt_version: str
    profile_id: str


@dataclass(frozen=True)
class EnrichmentResult:
    keywords: tuple[str, ...]
    questions: tuple[str, ...]
    provenance: EnrichmentProvenance


class EnrichmentService:
    def __init__(
        self,
        options: EnrichmentOptions,
        *,
        chat_provider: ChatProvider | None = None,
        cache: EnrichmentCache | None = None,
    ) -> None:
        self._options = options
        self._chat = chat_provider
        self._cache = cache

    @property
    def profile_id(self) -> str:
        return self._options.profile_id

    async def enrich_chunk(
        self,
        chunk: Chunk,
        *,
        language: str,
        manual_keywords: Iterable[str] = (),
        manual_questions: Iterable[str] = (),
        enabled: bool | None = None,
    ) -> tuple[Chunk, EnrichmentResult]:
        use_llm = self._options.enabled if enabled is None else enabled
        keywords = _clean_values(manual_keywords, kind="keyword")
        questions = _clean_values(manual_questions, kind="question")
        target_keywords = max(0, self._options.keyword_top_n - len(keywords))
        target_questions = max(0, self._options.question_top_n - len(questions))
        if not use_llm or (target_keywords == 0 and target_questions == 0):
            status = (
                EnrichmentStatus.MANUAL
                if keywords or questions
                else EnrichmentStatus.SKIPPED
            )
            result = EnrichmentResult(
                keywords=tuple(keywords[: self._options.keyword_top_n]),
                questions=tuple(questions[: self._options.question_top_n]),
                provenance=EnrichmentProvenance(
                    status=status,
                    language=language,
                    keyword_top_n=target_keywords,
                    question_top_n=target_questions,
                ),
            )
            return self._apply(chunk, result)

        if self._chat is None:
            # Runtime construction validates chat configuration before an import
            # starts. A direct service/fake adapter can still continue with the
            # documented soft-failure semantics for this individual chunk.
            result = EnrichmentResult(
                keywords=tuple(keywords),
                questions=tuple(questions),
                provenance=EnrichmentProvenance(
                    status=EnrichmentStatus.FAILED,
                    language=language,
                    keyword_top_n=target_keywords,
                    question_top_n=target_questions,
                    error_summary="chat provider is not configured",
                ),
            )
            return self._apply(chunk, result)
        retrieval_text = retrieval_text_for_chunk(chunk)
        content_hash = sha256(retrieval_text.encode("utf-8")).hexdigest()
        cache_key = self.cache_key(
            content_hash,
            self._chat.model_id,
            self._options.prompt_version,
            language,
            target_keywords,
            target_questions,
        )
        cached = (
            await self._cache.get_enrichment_cache(cache_key)
            if self._cache is not None
            else None
        )
        if cached is not None:
            try:
                generated_keywords, generated_questions = validate_enrichment_payload(
                    cached,
                    language=language,
                    keyword_top_n=target_keywords,
                    question_top_n=target_questions,
                )
            except ValueError:
                generated_keywords = generated_questions = ()
            else:
                result = EnrichmentResult(
                    keywords=tuple(_dedupe([*keywords, *generated_keywords])),
                    questions=tuple(_dedupe([*questions, *generated_questions])),
                    provenance=EnrichmentProvenance(
                        status=EnrichmentStatus.CACHED,
                        model=self._chat.model_id,
                        prompt_version=self._options.prompt_version,
                        cache_key=cache_key,
                        language=language,
                        keyword_top_n=target_keywords,
                        question_top_n=target_questions,
                        generated_keywords=bool(generated_keywords),
                        generated_questions=bool(generated_questions),
                    ),
                )
                return self._apply(chunk, result)

        generated: dict[str, list[str]] = {"keywords": [], "questions": []}
        errors: list[str] = []
        validated = False
        for attempt in range(2):
            payload: dict[str, Any] | None = None
            try:
                payload = await self._chat.complete_json(
                    system_prompt=_system_prompt(language),
                    user_prompt=_user_prompt(
                        retrieval_text,
                        keyword_top_n=target_keywords,
                        question_top_n=target_questions,
                        previous_error=errors[-1] if errors else "",
                    ),
                    schema_name="rag_chunk_enrichment",
                    schema=ENRICHMENT_SCHEMA,
                )
                generated_keywords, generated_questions = validate_enrichment_payload(
                    payload,
                    language=language,
                    keyword_top_n=target_keywords,
                    question_top_n=target_questions,
                )
                generated = {
                    "keywords": list(generated_keywords),
                    "questions": list(generated_questions),
                }
                if self._cache is not None:
                    try:
                        await self._cache.put_enrichment_cache(
                            cache_key,
                            content_sha256=content_hash,
                            chat_model=self._chat.model_id,
                            prompt_version=self._options.prompt_version,
                            language=language,
                            keyword_top_n=target_keywords,
                            question_top_n=target_questions,
                            result=generated,
                        )
                    except Exception as exc:  # noqa: BLE001 - cache is advisory
                        errors.append(f"cache write failed: {_error_summary(exc)}")
                validated = True
                break
            except Exception as exc:  # noqa: BLE001 - a chunk-level soft failure
                if isinstance(payload, dict):
                    generated = _valid_partial_payload(
                        payload,
                        language=language,
                        keyword_top_n=target_keywords,
                        question_top_n=target_questions,
                        previous=generated,
                    )
                errors.append(_error_summary(exc))

        if not generated["keywords"] and target_keywords:
            errors.append("keywords unavailable")
        if not generated["questions"] and target_questions:
            errors.append("questions unavailable")
        failed = bool(errors) and (
            len(generated["keywords"]) < target_keywords
            or len(generated["questions"]) < target_questions
        )
        if validated:
            status = EnrichmentStatus.SUCCEEDED
        elif generated["keywords"] or generated["questions"]:
            status = EnrichmentStatus.PARTIAL
        else:
            status = EnrichmentStatus.FAILED
        result = EnrichmentResult(
            keywords=tuple(_dedupe([*keywords, *generated["keywords"]]))[
                : self._options.keyword_top_n
            ],
            questions=tuple(_dedupe([*questions, *generated["questions"]]))[
                : self._options.question_top_n
            ],
            provenance=EnrichmentProvenance(
                status=status,
                model=self._chat.model_id,
                prompt_version=self._options.prompt_version,
                cache_key=cache_key,
                language=language,
                keyword_top_n=target_keywords,
                question_top_n=target_questions,
                generated_keywords=bool(generated["keywords"]),
                generated_questions=bool(generated["questions"]),
                error_summary="; ".join(_dedupe(errors))[:500] if failed else "",
            ),
        )
        return self._apply(chunk, result)

    def cache_key(
        self,
        content_hash: str,
        chat_model: str,
        prompt_version: str,
        language: str,
        keyword_top_n: int,
        question_top_n: int,
    ) -> str:
        material = "\x1f".join(
            (
                content_hash,
                chat_model,
                prompt_version,
                language,
                str(keyword_top_n),
                str(question_top_n),
            )
        )
        return sha256(material.encode("utf-8")).hexdigest()

    def _apply(
        self, chunk: Chunk, result: EnrichmentResult
    ) -> tuple[Chunk, EnrichmentResult]:
        fields = lexical_fields(
            title=chunk.title,
            content=retrieval_text_for_chunk(chunk),
            important_keywords=result.keywords,
            questions=result.questions,
        )
        enriched = Chunk(
            **{
                **chunk.__dict__,
                **fields,
                "content_with_weight": chunk.content,
                "enrichment": result.provenance,
            }
        )
        return enriched, result


def validate_enrichment_payload(
    payload: dict[str, Any],
    *,
    language: str,
    keyword_top_n: int,
    question_top_n: int,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if not isinstance(payload, dict):
        raise ValueError("enrichment response must be an object")
    keywords = _validate_list(
        payload.get("keywords"),
        kind="keyword",
        expected=keyword_top_n,
        language=language,
    )
    questions = _validate_list(
        payload.get("questions"),
        kind="question",
        expected=question_top_n,
        language=language,
    )
    return tuple(keywords), tuple(questions)


def _validate_list(value: Any, *, kind: str, expected: int, language: str) -> list[str]:
    if expected == 0:
        return []
    if not isinstance(value, list) or len(value) != expected:
        raise ValueError(f"{kind} count must be exactly {expected}")
    cleaned = _clean_values(value, kind=kind)
    if len(cleaned) != expected:
        raise ValueError(f"{kind} values must be non-empty and unique")
    if any(not _language_ok(item, language) for item in cleaned):
        raise ValueError(f"{kind} language does not match chunk language")
    return cleaned


def _valid_partial_payload(
    payload: dict[str, Any],
    *,
    language: str,
    keyword_top_n: int,
    question_top_n: int,
    previous: dict[str, list[str]],
) -> dict[str, list[str]]:
    result = {key: list(value) for key, value in previous.items()}
    for key, kind, expected in (
        ("keywords", "keyword", keyword_top_n),
        ("questions", "question", question_top_n),
    ):
        try:
            values = _validate_list(
                payload.get(key),
                kind=kind,
                expected=expected,
                language=language,
            )
        except ValueError:
            continue
        result[key] = values
    return result


def _clean_values(values: Iterable[Any] | None, *, kind: str) -> list[str]:
    if values is None:
        return []
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError(f"{kind} values must be strings")
        value = re.sub(r"\s+", " ", value).strip()
        limit = 80 if kind == "keyword" else 300
        minimum = 1 if kind == "keyword" else 2
        if not minimum <= len(value) <= limit:
            raise ValueError(f"{kind} length is outside allowed bounds")
        folded = value.casefold()
        if folded not in {item.casefold() for item in result}:
            result.append(value)
    return result


def _language_ok(value: str, language: str) -> bool:
    cjk = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", value))
    letters = len(re.findall(r"[A-Za-z]", value))
    if language.lower().startswith(("zh", "ja", "ko")):
        return cjk > 0 or letters > 0
    return cjk <= max(1, letters // 3)


def detect_language(text: str) -> str:
    cjk = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return "zh" if cjk >= max(2, latin // 2) else "en"


def _system_prompt(language: str) -> str:
    return (
        "You enrich one retrieval chunk. Return only JSON with arrays named "
        "keywords and questions. Keep the same language as the input, do not "
        "invent facts, and never include markdown. Language: "
        f"{language}."
    )


def _user_prompt(
    content: str, *, keyword_top_n: int, question_top_n: int, previous_error: str
) -> str:
    retry = f" Previous validation error: {previous_error}." if previous_error else ""
    return (
        f"Chunk:\n{content}\n\nGenerate exactly {keyword_top_n} concise retrieval "
        f"keywords/phrases and exactly {question_top_n} answerable questions. "
        "Use empty arrays only when the requested count is zero."
        f"{retry}"
    )


def _dedupe(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        folded = value.casefold()
        if folded and folded not in seen:
            seen.add(folded)
            result.append(value)
    return result


def _error_summary(exc: Exception) -> str:
    text = str(exc).replace("\n", " ").strip()
    return text[:180] or exc.__class__.__name__
