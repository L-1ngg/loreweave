from __future__ import annotations

from collections.abc import Iterable
import re
import unicodedata


_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_WORD_RE = re.compile(r"[A-Za-z0-9_]+")


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text).strip()


def fine_tokens(text: str) -> list[str]:
    """Return RAGFlow-like fine tokens: CJK characters and Latin words."""

    normalized = normalize_text(text).lower()
    return [match.group(0) for match in _TOKEN_RE.finditer(normalized)]


def coarse_tokens(text: str) -> list[str]:
    """Return whitespace-safe coarse tokens for explicit ES text fields."""

    normalized = normalize_text(text).lower()
    tokens: list[str] = []
    for part in re.split(r"\s+", normalized):
        if not part:
            continue
        latin = _WORD_RE.findall(part)
        cjk = re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+", part)
        tokens.extend(latin or cjk or [part])
    return tokens


def token_string(tokens: Iterable[str]) -> str:
    return " ".join(token for token in tokens if token)


def lexical_fields(
    *,
    title: str,
    content: str,
    important_keywords: Iterable[str],
    questions: Iterable[str],
) -> dict[str, str | tuple[str, ...]]:
    keywords = tuple(_dedupe(normalize_text(item) for item in important_keywords))
    question_values = tuple(_dedupe(normalize_text(item) for item in questions))
    return {
        "important_kwd": keywords,
        "important_tks": token_string(fine_tokens(" ".join(keywords))),
        "question_kwd": question_values,
        "question_tks": token_string(fine_tokens(" ".join(question_values))),
        "title_tks": token_string(coarse_tokens(title)),
        "title_sm_tks": token_string(fine_tokens(title)),
        "content_ltks": token_string(coarse_tokens(content)),
        "content_sm_ltks": token_string(fine_tokens(content)),
    }


def query_features(query: str) -> tuple[list[str], list[str]]:
    tokens = fine_tokens(query)
    bigrams = [f"{left} {right}" for left, right in zip(tokens, tokens[1:])]
    return tokens, bigrams


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        folded = value.casefold()
        if not folded or folded in seen:
            continue
        seen.add(folded)
        result.append(value)
    return result
