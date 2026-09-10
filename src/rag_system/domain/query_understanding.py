from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
import re
import unicodedata
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import dateparser
from opencc import OpenCC

from .models import QueryContext, QueryPlan, QueryReplacement
from .ports import ChatProvider


NORMALIZATION_VERSION = "nfkc-t2s-boundary-v1"
_OPENCC = OpenCC("t2s")
_REFERENCE_RE = re.compile(
    r"(?:它|其|该项目|这个项目|这个人|他|她|前者|后者|那一年|当年|"
    r"(?<![A-Za-z])(?:it|this project|that project|he|she|former|latter|that year)(?![A-Za-z]))",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"https?://[^\s\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|"
    r"www\.[^\s\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+",
    re.IGNORECASE,
)
_LUCENE_SPECIAL = re.compile(r'([+\-=&|><!(){}\[\]^"~*?:\\/])')
_AMBIGUOUS_DATE_RE = re.compile(r"(?<!\d)\d{1,2}/\d{1,2}/\d{4}(?!\d)")
_DATE_EXPR = r"(?:19|20)\d{2}\s*(?:[-/.年])\s*\d{1,2}(?:\s*月)?(?:\s*[-/.]\s*\d{1,2}\s*日?|\s*月\s*\d{1,2}\s*日?)?"
_ABSOLUTE_DATE_COMPONENTS_RE = re.compile(
    r"^(?P<year>(?:19|20)\d{2})(?:"
    r"(?:[-/.])(?P<month_dash>\d{1,2})"
    r"(?:(?:[-/.])(?P<day_dash>\d{1,2})日?)?"
    r"|年(?P<month_cn>\d{1,2})月?(?:(?P<day_cn>\d{1,2})日?)?"
    r")$"
)
_OR_CONNECTOR_RE = re.compile(r"(?:^|[\s,，])or(?=$|[\s,，])|或者|或", re.IGNORECASE)
_NEGATIVE_CONNECTOR_RE = re.compile(
    r"(?:^|[\s,，])(?:not|without)(?=$|[\s,，])|排除|不要|不含",
    re.IGNORECASE,
)


class EntityAliasProvider(Protocol):
    async def list_entity_aliases(
        self, knowledge_base_id: str
    ) -> list[dict[str, Any]]: ...


@dataclass(frozen=True)
class EntityHit:
    start: int
    end: int
    alias: str
    entity_ref: str
    entity_type: str
    canonical_name: str


@dataclass
class _TrieNode:
    children: dict[str, "_TrieNode"]
    records: list[dict[str, str]]

    def __init__(self) -> None:
        self.children = {}
        self.records = []


class EntityAliasMatcher:
    """Knowledge-base alias trie with longest non-overlapping matches."""

    def __init__(self, records: Iterable[dict[str, Any]]) -> None:
        self._root = _TrieNode()
        for source in records:
            alias = normalize_query(str(source.get("alias", "")))
            entity_ref = str(source.get("entity_ref", ""))
            if not alias or not entity_ref:
                continue
            node = self._root
            for character in alias:
                node = node.children.setdefault(character, _TrieNode())
            node.records.append(
                {
                    "alias": alias,
                    "entity_ref": entity_ref,
                    "entity_type": str(source.get("entity_type", "")),
                    "canonical_name": str(source.get("canonical_name", alias)),
                }
            )

    def match(self, text: str) -> tuple[list[EntityHit], list[str]]:
        normalized = normalize_query(text)
        hits: list[EntityHit] = []
        ambiguities: list[str] = []
        index = 0
        while index < len(normalized):
            node = self._root
            cursor = index
            longest: tuple[int, list[dict[str, str]]] | None = None
            while cursor < len(normalized) and normalized[cursor] in node.children:
                node = node.children[normalized[cursor]]
                cursor += 1
                if node.records:
                    longest = cursor, node.records
            if longest is None:
                index += 1
                continue
            end, records = longest
            selected = _select_entity_record(records, normalized)
            if selected is None:
                alias = normalized[index:end]
                ambiguities.append(
                    f"entity alias {alias!r} matches "
                    f"{', '.join(sorted({item['entity_ref'] for item in records}))}"
                )
            else:
                hits.append(
                    EntityHit(
                        start=index,
                        end=end,
                        alias=selected["alias"],
                        entity_ref=selected["entity_ref"],
                        entity_type=selected["entity_type"],
                        canonical_name=selected["canonical_name"],
                    )
                )
            index = end
        return hits, ambiguities


class QueryUnderstandingService:
    def __init__(
        self,
        *,
        alias_provider: EntityAliasProvider | None = None,
        chat_provider: ChatProvider | None = None,
        relative_base: datetime | None = None,
        timezone: str = "Asia/Shanghai",
    ) -> None:
        self._alias_provider = alias_provider
        self._chat = chat_provider
        self._timezone = ZoneInfo(timezone)
        selected_base = relative_base or datetime.now(self._timezone)
        if selected_base.tzinfo is None:
            selected_base = selected_base.replace(tzinfo=self._timezone)
        self._relative_base = selected_base.astimezone(self._timezone)

    async def build_plan(
        self,
        query: str,
        knowledge_base_id: str,
        *,
        explicit_filters: dict[str, Any] | None = None,
        context: Sequence[QueryContext] = (),
    ) -> tuple[QueryPlan, QueryContext]:
        if not query.strip() or len(query) > 2000:
            raise ValueError("query must contain between 1 and 2000 characters")
        if len(context) > 4:
            raise ValueError("context can contain at most 4 query turns")
        ambiguities: list[str] = []
        resolved, replacements, reference_ambiguities = await self._resolve_references(
            query, context
        )
        ambiguities.extend(reference_ambiguities)
        normalized = normalize_query(resolved)
        time_filters, spans, time_ambiguities = parse_time_filters(
            normalized,
            relative_base=self._relative_base,
            timezone=self._timezone,
        )
        ambiguities.extend(time_ambiguities)

        records = (
            await self._alias_provider.list_entity_aliases(knowledge_base_id)
            if self._alias_provider is not None
            else []
        )
        matcher = EntityAliasMatcher(records)
        entity_hits, entity_ambiguities = matcher.match(normalized)
        ambiguities.extend(entity_ambiguities)
        inferred = dict(time_filters)
        entity_filter = _entity_filter(normalized, entity_hits)
        if entity_filter:
            inferred["entity_refs"] = entity_filter
        combined, conflicts = merge_filters(explicit_filters or {}, inferred)
        ambiguities.extend(conflicts)

        search_text = _remove_spans(normalized, spans).strip() or normalized
        plan = QueryPlan(
            normalization_version=NORMALIZATION_VERSION,
            raw_query=query,
            resolved_query=resolved,
            lexical_query=escape_lexical_query(search_text),
            semantic_query=search_text,
            filters=combined,
            replacements=tuple(replacements),
            ambiguities=tuple(_dedupe(ambiguities)),
        )
        next_context = QueryContext(
            user_query=query,
            resolved_query=resolved,
            entity_refs=tuple(
                _dedupe(
                    [
                        *(hit.entity_ref for hit in entity_hits),
                        *(
                            replacement.replacement
                            for replacement in replacements
                            if replacement.kind == "entity"
                        ),
                    ]
                )
            ),
            time_expressions=tuple(normalized[start:end] for start, end in spans),
            selected_document_id=(context[-1].selected_document_id if context else ""),
        )
        return plan, next_context

    async def _resolve_references(
        self, query: str, context: Sequence[QueryContext]
    ) -> tuple[str, list[QueryReplacement], list[str]]:
        if not _REFERENCE_RE.search(query) or not context:
            return query.strip(), [], []
        if self._chat is None:
            return query.strip(), [], ["reference resolution unavailable"]
        allowed: set[str] = set()
        for item in context:
            allowed.update(item.entity_refs)
            allowed.update(item.time_expressions)
            if item.selected_document_id:
                allowed.add(item.selected_document_id)
        if not allowed:
            return query.strip(), [], ["reference has no known contextual target"]
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "resolved_query": {"type": "string"},
                "confidence": {"type": "number"},
                "replacements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "original": {"type": "string"},
                            "replacement": {"type": "string"},
                            "kind": {"type": "string"},
                        },
                        "required": ["original", "replacement", "kind"],
                    },
                },
            },
            "required": ["resolved_query", "confidence", "replacements"],
        }
        try:
            payload = await self._chat.complete_json(
                system_prompt=(
                    "Resolve only pronouns or omitted references. Replacement values "
                    "must be copied exactly from allowed_targets. Do not add, remove, "
                    "paraphrase, or expand any other query terms."
                ),
                user_prompt=(
                    f"query={query!r}\nallowed_targets={sorted(allowed)!r}\n"
                    f"recent_context={[item.__dict__ for item in context]!r}"
                ),
                schema_name="restricted_reference_resolution",
                schema=schema,
            )
            confidence = payload.get("confidence")
            if not isinstance(confidence, (int, float)) or confidence < 0.7:
                raise ValueError("reference resolution confidence is too low")
            replacement_values = payload.get("replacements")
            if not isinstance(replacement_values, list) or not replacement_values:
                raise ValueError("reference resolution has no replacements")
            replacements: list[QueryReplacement] = []
            computed = query
            for value in replacement_values:
                if not isinstance(value, dict):
                    raise ValueError("reference replacement is invalid")
                original = value.get("original")
                replacement = value.get("replacement")
                kind = value.get("kind")
                if (
                    not isinstance(original, str)
                    or not _REFERENCE_RE.fullmatch(original)
                    or original not in computed
                    or replacement not in allowed
                    or kind not in {"entity", "time", "document"}
                ):
                    raise ValueError("reference replacement is outside known context")
                computed = computed.replace(original, replacement, 1)
                replacements.append(QueryReplacement(original, replacement, kind))
            resolved = payload.get("resolved_query")
            if not isinstance(resolved, str) or normalize_query(
                resolved
            ) != normalize_query(computed):
                raise ValueError("reference resolver attempted to expand the query")
            return resolved.strip(), replacements, []
        except Exception:
            return (
                query.strip(),
                [],
                ["reference resolution rejected; original query used"],
            )


def normalize_query(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = _OPENCC.convert(value)
    value = _URL_RE.sub(" ", value)
    value = "".join(
        " " if unicodedata.category(character).startswith("C") else character
        for character in value
    )
    value = re.sub(r"(?<=[A-Za-z0-9])(?=[\u3400-\u9fff])", " ", value)
    value = re.sub(r"(?<=[\u3400-\u9fff])(?=[A-Za-z0-9])", " ", value)
    value = "".join(
        character.lower() if "A" <= character <= "Z" else character
        for character in value
    )
    return _space(value)


def escape_lexical_query(value: str) -> str:
    return _LUCENE_SPECIAL.sub(r"\\\1", value)


def parse_time_filters(
    query: str,
    *,
    relative_base: datetime,
    timezone: ZoneInfo,
) -> tuple[dict[str, Any], list[tuple[int, int]], list[str]]:
    filters: dict[str, Any] = {}
    spans: list[tuple[int, int]] = []
    ambiguities: list[str] = []
    invalid_spans: list[tuple[int, int]] = []
    field = _time_field(query)
    if match := _AMBIGUOUS_DATE_RE.search(query):
        ambiguities.append(f"ambiguous date {match.group(0)!r} was not filtered")

    candidates: list[tuple[int, int, datetime, datetime]] = []
    boundary_pattern = re.compile(
        r"(?P<op>since|after|before|自|从)?\s*"
        rf"(?P<date>{_DATE_EXPR})"
        r"\s*(?P<suffix>以来|之后|以后|之前|以前)?",
        re.IGNORECASE,
    )
    for match in boundary_pattern.finditer(query):
        op = (match.group("op") or match.group("suffix") or "").lower()
        if not op:
            continue
        parsed = _parse_date(match.group("date"), relative_base, timezone)
        if parsed is None:
            ambiguities.append(f"date {match.group('date')!r} could not be parsed")
            invalid_spans.append(match.span())
            continue
        day_end = parsed + timedelta(days=1)
        if op in {"before", "之前", "以前"}:
            start, end = datetime(1970, 1, 1, tzinfo=timezone), parsed
        elif op in {"after", "之后", "以后"}:
            start, end = day_end, datetime(9999, 1, 1, tzinfo=timezone)
        else:
            start, end = parsed, datetime(9999, 1, 1, tzinfo=timezone)
        candidates.append((*match.span(), start, end))

    patterns = [
        (
            re.compile(
                r"(?P<year>(?:19|20)\d{2})\s*(?:年|[-/.])\s*(?P<month>\d{1,2})(?:\s*(?:月|[-/.])\s*(?P<day>\d{1,2})\s*日?)?"
            ),
            _absolute_range,
        ),
        (
            re.compile(
                r"(?:(?P<year>(?:19|20)\d{2})\s*年?\s*(?:第)?\s*(?P<quarter>[1-4])\s*季度|(?P<year2>(?:19|20)\d{2})\s*q\s*(?P<quarter2>[1-4]))",
                re.IGNORECASE,
            ),
            _quarter_range,
        ),
        (
            re.compile(r"去年|last\s+year", re.IGNORECASE),
            lambda _m, base, _tz: (
                datetime(base.year - 1, 1, 1, tzinfo=base.tzinfo),
                datetime(base.year, 1, 1, tzinfo=base.tzinfo),
            ),
        ),
        (
            re.compile(r"今年|this\s+year", re.IGNORECASE),
            lambda _m, base, _tz: (
                datetime(base.year, 1, 1, tzinfo=base.tzinfo),
                datetime(base.year + 1, 1, 1, tzinfo=base.tzinfo),
            ),
        ),
        (
            re.compile(r"本月|this\s+month", re.IGNORECASE),
            _this_month_range,
        ),
        (
            re.compile(
                r"(?:最近|过去|last)\s*(?P<days>\d{1,4})\s*(?:天|days?)", re.IGNORECASE
            ),
            _last_days_range,
        ),
    ]
    for pattern, converter in patterns:
        for match in pattern.finditer(query):
            if any(_overlaps(match.span(), item[:2]) for item in candidates):
                continue
            try:
                start, end = converter(match, relative_base, timezone)
            except (OverflowError, ValueError):
                ambiguities.append(f"date {match.group(0)!r} could not be parsed")
                invalid_spans.append(match.span())
                continue
            candidates.append((*match.span(), start, end))

    boundary_pattern = re.compile(
        rf"(?P<date>{_DATE_EXPR})",
        re.IGNORECASE,
    )
    for match in boundary_pattern.finditer(query):
        if any(
            _overlaps(match.span(), item[:2]) for item in (*candidates, *invalid_spans)
        ):
            continue
        parsed = _parse_date(match.group("date"), relative_base, timezone)
        if parsed is None:
            ambiguities.append(f"date {match.group('date')!r} could not be parsed")
            invalid_spans.append(match.span())
            continue
        day_end = parsed + timedelta(days=1)
        start, end = parsed, day_end
        candidates.append((*match.span(), start, end))

    if candidates:
        start = max(candidate[2] for candidate in candidates)
        end = min(candidate[3] for candidate in candidates)
        spans = sorted((candidate[0], candidate[1]) for candidate in candidates)
        if start >= end:
            filters["__empty__"] = True
            ambiguities.append("time filters have an empty intersection")
        elif field == "effective":
            filters["effective"] = {"gte": start.isoformat(), "lt": end.isoformat()}
        else:
            filters[field] = {"gte": start.isoformat(), "lt": end.isoformat()}
    return filters, spans, ambiguities


def normalize_explicit_filters(filters: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "source_type",
        "language",
        "tags",
        "source_date",
        "effective",
        "created_at",
        "entity_refs",
        "document_id",
    }
    unknown = set(filters) - allowed
    if unknown:
        raise ValueError(f"unsupported explicit filters: {', '.join(sorted(unknown))}")
    normalized: dict[str, Any] = {}
    for field, value in filters.items():
        if field in {"source_date", "effective", "created_at"}:
            if not isinstance(value, dict) or not (
                {"gte", "gt", "lte", "lt"} & set(value)
            ):
                raise ValueError(f"{field} must be a range object")
            normalized[field] = {
                key: str(item)
                for key, item in value.items()
                if key in {"gte", "gt", "lte", "lt"}
            }
            continue
        if isinstance(value, str):
            normalized[field] = {"all": [value]}
        elif isinstance(value, list) and all(isinstance(item, str) for item in value):
            normalized[field] = {"all": _dedupe(value)}
        elif isinstance(value, dict):
            clause: dict[str, list[str]] = {}
            for operator in ("all", "any", "none"):
                values = value.get(operator, [])
                if isinstance(values, str):
                    values = [values]
                if not isinstance(values, list) or not all(
                    isinstance(item, str) for item in values
                ):
                    raise ValueError(f"{field}.{operator} must contain strings")
                if values:
                    clause[operator] = _dedupe(values)
            normalized[field] = clause
        else:
            raise ValueError(f"invalid explicit filter for {field}")
    return normalized


def merge_filters(
    explicit: dict[str, Any], inferred: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    result = normalize_explicit_filters(explicit)
    conflicts: list[str] = []
    for field, inferred_value in inferred.items():
        if field == "__empty__":
            result[field] = True
            continue
        if field not in result:
            result[field] = inferred_value
            continue
        explicit_value = result[field]
        if field in {"source_date", "effective", "created_at"}:
            combined = _intersect_ranges(explicit_value, inferred_value)
            if combined is None:
                result["__empty__"] = True
                conflicts.append(f"explicit and inferred {field} filters conflict")
            else:
                result[field] = combined
            continue
        if isinstance(explicit_value, dict) and isinstance(inferred_value, dict):
            combined = {
                "all": _dedupe(
                    [*explicit_value.get("all", []), *inferred_value.get("all", [])]
                ),
                "none": _dedupe(
                    [*explicit_value.get("none", []), *inferred_value.get("none", [])]
                ),
            }
            left_any = explicit_value.get("any", [])
            right_any = inferred_value.get("any", [])
            if left_any and right_any:
                combined["any"] = [item for item in left_any if item in right_any]
                if not combined["any"]:
                    result["__empty__"] = True
                    conflicts.append(f"explicit and inferred {field} filters conflict")
            else:
                combined["any"] = list(left_any or right_any)
            result[field] = {key: value for key, value in combined.items() if value}
    return result, conflicts


def _select_entity_record(
    records: list[dict[str, str]], query: str
) -> dict[str, str] | None:
    refs = {record["entity_ref"] for record in records}
    if len(refs) == 1:
        return records[0]
    hinted = [
        record
        for record in records
        if record["entity_type"] and normalize_query(record["entity_type"]) in query
    ]
    return hinted[0] if len({item["entity_ref"] for item in hinted}) == 1 else None


def _entity_filter(query: str, hits: Sequence[EntityHit]) -> dict[str, list[str]]:
    all_values: list[str] = []
    any_values: list[str] = []
    none_values: list[str] = []
    for index, hit in enumerate(hits):
        previous_end = hits[index - 1].end if index else 0
        next_start = hits[index + 1].start if index + 1 < len(hits) else len(query)
        left_context = query[previous_end : hit.start]
        right_context = query[hit.end : next_start]
        if _NEGATIVE_CONNECTOR_RE.search(left_context):
            none_values.append(hit.entity_ref)
        elif _OR_CONNECTOR_RE.search(f"{left_context} {right_context}"):
            any_values.append(hit.entity_ref)
        else:
            all_values.append(hit.entity_ref)
    result = {}
    if all_values:
        result["all"] = _dedupe(all_values)
    if any_values:
        result["any"] = _dedupe(any_values)
    if none_values:
        result["none"] = _dedupe(none_values)
    return result


def _time_field(query: str) -> str:
    if re.search(r"生效|有效|effective|valid", query, re.IGNORECASE):
        return "effective"
    if re.search(
        r"导入|入库|ingest(?:ed|ion)?|import(?:ed|ation)?|upload(?:ed)?|created",
        query,
        re.IGNORECASE,
    ):
        return "created_at"
    return "source_date"


def _absolute_range(
    match: re.Match[str], _base: datetime, timezone: ZoneInfo
) -> tuple[datetime, datetime]:
    year = int(match.group("year"))
    month = int(match.group("month"))
    day = match.group("day")
    start = datetime(year, month, int(day or 1), tzinfo=timezone)
    if day:
        end = start + timedelta(days=1)
    elif month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone)
    return start, end


def _quarter_range(
    match: re.Match[str], _base: datetime, timezone: ZoneInfo
) -> tuple[datetime, datetime]:
    year = int(match.group("year") or match.group("year2"))
    quarter = int(match.group("quarter") or match.group("quarter2"))
    month = 1 + (quarter - 1) * 3
    start = datetime(year, month, 1, tzinfo=timezone)
    end = datetime(
        year + (1 if quarter == 4 else 0),
        1 if quarter == 4 else month + 3,
        1,
        tzinfo=timezone,
    )
    return start, end


def _this_month_range(
    _match: re.Match[str], base: datetime, _timezone: ZoneInfo
) -> tuple[datetime, datetime]:
    start = datetime(base.year, base.month, 1, tzinfo=base.tzinfo)
    end = datetime(
        base.year + (1 if base.month == 12 else 0),
        1 if base.month == 12 else base.month + 1,
        1,
        tzinfo=base.tzinfo,
    )
    return start, end


def _last_days_range(
    match: re.Match[str], base: datetime, _timezone: ZoneInfo
) -> tuple[datetime, datetime]:
    end = datetime(base.year, base.month, base.day, tzinfo=base.tzinfo) + timedelta(
        days=1
    )
    return end - timedelta(days=int(match.group("days"))), end


def _parse_date(value: str, base: datetime, timezone: ZoneInfo) -> datetime | None:
    value = re.sub(r"\s*([年月日])\s*", r"\1", value)
    compact = re.sub(r"\s+", "", value)
    components = _ABSOLUTE_DATE_COMPONENTS_RE.fullmatch(compact)
    if components is not None:
        month = int(components.group("month_dash") or components.group("month_cn"))
        day_value = components.group("day_dash") or components.group("day_cn")
        day = int(day_value) if day_value else 1
        try:
            datetime(int(components.group("year")), month, day)
        except ValueError:
            return None
    parsed = dateparser.parse(
        value,
        languages=["zh", "en"],
        settings={
            "RELATIVE_BASE": base.replace(tzinfo=None),
            "TIMEZONE": timezone.key,
            "RETURN_AS_TIMEZONE_AWARE": True,
            "PREFER_DATES_FROM": "past",
            "PREFER_DAY_OF_MONTH": "first",
            "DATE_ORDER": "YMD",
        },
    )
    return parsed.astimezone(timezone) if parsed is not None else None


def _intersect_ranges(
    left: dict[str, str], right: dict[str, str]
) -> dict[str, str] | None:
    lower = max(
        filter(
            None,
            (left.get("gte") or left.get("gt"), right.get("gte") or right.get("gt")),
        ),
        default="",
    )
    upper_values = [
        value
        for value in (
            left.get("lt") or left.get("lte"),
            right.get("lt") or right.get("lte"),
        )
        if value
    ]
    upper = min(upper_values) if upper_values else ""
    if lower and upper and lower >= upper:
        return None
    result: dict[str, str] = {}
    if lower:
        result["gte"] = lower
    if upper:
        result["lt"] = upper
    return result


def _remove_spans(value: str, spans: Sequence[tuple[int, int]]) -> str:
    characters = list(value)
    for start, end in spans:
        characters[start:end] = " " * (end - start)
    return _space("".join(characters))


def _overlaps(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]


def _space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _dedupe(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))
