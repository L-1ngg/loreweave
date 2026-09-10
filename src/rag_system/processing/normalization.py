from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from hashlib import sha1
import io
import json
from pathlib import PurePosixPath
import re
from typing import Any
from zipfile import ZipFile

from .cleaning import clean_text
from ..domain.models import DocumentBlock


class NormalizationError(ValueError):
    """Raised when a MinerU result archive is unsafe or cannot be normalized."""


_AUXILIARY_TYPES = {
    "header",
    "footer",
    "page_number",
    "aside_text",
    "page_footnote",
    "page_header",
    "page_footer",
    "page_aside_text",
}
_IMAGE_PATTERN = re.compile(r"!\[[^\]]*]\(([^)]+)\)")


@dataclass(frozen=True)
class NormalizedMinerUArchive:
    blocks: tuple[DocumentBlock, ...]
    files: Mapping[str, bytes]


def load_mineru_archive(archive: bytes, *, max_bytes: int) -> NormalizedMinerUArchive:
    files = _read_safe_archive(archive, max_bytes=max_bytes)
    return NormalizedMinerUArchive(blocks=_normalize_files(files), files=files)


def normalize_mineru_archive(
    archive: bytes, *, max_bytes: int
) -> tuple[DocumentBlock, ...]:
    return load_mineru_archive(archive, max_bytes=max_bytes).blocks


def resolve_archive_file(
    files: Mapping[str, bytes], reference: str
) -> tuple[str, bytes] | None:
    normalized = _normalize_asset_ref(reference)
    exact = files.get(normalized)
    if exact is not None:
        return normalized, exact
    matches = [
        (path, content)
        for path, content in files.items()
        if path.endswith(f"/{normalized}")
    ]
    if len(matches) > 1:
        raise NormalizationError(f"ambiguous archive reference {reference!r}")
    return matches[0] if matches else None


def _normalize_files(files: Mapping[str, bytes]) -> tuple[DocumentBlock, ...]:
    reading_order = 0

    content_list_v2 = _load_json_file(files, "content_list_v2.json")
    if content_list_v2 is not None:
        return _blocks_from_content_list_v2(
            content_list_v2, files, reading_order_start=reading_order
        )

    markdown_bytes = _find_file(files, "full.md")
    if markdown_bytes is not None:
        return _blocks_from_markdown(
            markdown_bytes.decode("utf-8"),
            files,
            reading_order_start=reading_order,
        )

    raise NormalizationError(
        "MinerU archive did not contain content_list_v2.json or full.md"
    )


def derive_title(blocks: Iterable[DocumentBlock], fallback: str = "untitled") -> str:
    for block in blocks:
        if block.type == "heading" and block.text.strip():
            return block.text.strip()
    for block in blocks:
        if block.text.strip():
            return block.text.strip()[:160]
    return fallback


def _read_safe_archive(archive: bytes, *, max_bytes: int) -> dict[str, bytes]:
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")

    try:
        with ZipFile(io.BytesIO(archive)) as zf:
            total_uncompressed = 0
            files: dict[str, bytes] = {}
            for info in zf.infolist():
                if info.is_dir():
                    continue
                normalized = _safe_member_name(info.filename)
                if normalized in files:
                    raise NormalizationError(
                        f"duplicate zip member path {normalized!r}"
                    )
                total_uncompressed += info.file_size
                if total_uncompressed > max_bytes:
                    raise NormalizationError(
                        f"MinerU archive exceeded max_bytes ({max_bytes})"
                    )
                files[normalized] = zf.read(info)
    except NormalizationError:
        raise
    except Exception as exc:
        raise NormalizationError(f"failed to read MinerU archive: {exc}") from exc
    return files


def _safe_member_name(filename: str) -> str:
    if "\\" in filename or "\x00" in filename:
        raise NormalizationError(f"unsafe zip member path {filename!r}")
    path = PurePosixPath(filename)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        raise NormalizationError(f"unsafe zip member path {filename!r}")
    return str(path)


def _load_json_file(files: Mapping[str, bytes], suffix: str) -> Any | None:
    content = _find_file(files, suffix)
    if content is None:
        return None
    try:
        return json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise NormalizationError(f"failed to decode {suffix}: {exc}") from exc


def _find_file(files: Mapping[str, bytes], suffix: str) -> bytes | None:
    exact = files.get(suffix)
    if exact is not None:
        return exact
    matches = [
        content for path, content in files.items() if path.endswith(f"/{suffix}")
    ]
    if len(matches) > 1:
        raise NormalizationError(f"ambiguous archive file {suffix!r}")
    return matches[0] if matches else None


def _blocks_from_content_list_v2(
    payload: Any,
    files: Mapping[str, bytes],
    *,
    reading_order_start: int,
) -> tuple[DocumentBlock, ...]:
    blocks: list[DocumentBlock] = []
    current_sections: list[str] = []
    reading_order = reading_order_start
    for page_index, item in _iter_v2_blocks(payload):
        raw_type = str(item.get("type") or "").strip()
        if raw_type in _AUXILIARY_TYPES:
            continue
        block_type, text, markdown, metadata = _materialize_v2_block(raw_type, item)
        if not text and not markdown:
            continue
        if block_type == "heading":
            level = max(1, int(metadata.get("level", 1)))
            current_sections = _next_section_path(current_sections, text, level)
            section_path = tuple(current_sections)
        else:
            section_path = tuple(current_sections)
        reading_order += 1
        asset_refs = _asset_refs_from_mapping(item, files)
        blocks.append(
            DocumentBlock(
                block_id=_block_id(
                    reading_order=reading_order,
                    page_start=page_index,
                    block_type=block_type,
                    section_path=section_path,
                    text=text,
                    asset_refs=asset_refs,
                ),
                type=block_type,
                text=text,
                markdown=markdown,
                page_start=page_index,
                page_end=page_index,
                section_path=section_path,
                bounding_boxes=_bbox_tuple(item.get("bbox")),
                asset_refs=asset_refs,
                reading_order=reading_order,
                metadata=metadata,
            )
        )
    return tuple(blocks)


def _iter_v2_blocks(payload: Any) -> Iterable[tuple[int, Mapping[str, Any]]]:
    if isinstance(payload, Mapping):
        payload = payload.get("pages") or payload.get("content_list")
    if not isinstance(payload, list):
        raise NormalizationError(
            "content_list_v2.json must contain a list of pages or blocks"
        )

    for fallback_page, entry in enumerate(payload, start=1):
        if isinstance(entry, list):
            for item in entry:
                if isinstance(item, Mapping):
                    yield fallback_page, item
            continue
        if not isinstance(entry, Mapping):
            continue
        nested_blocks = entry.get("blocks")
        if isinstance(nested_blocks, list):
            page_index = _page_number(entry, fallback_page)
            for item in nested_blocks:
                if isinstance(item, Mapping):
                    yield page_index, item
            continue
        yield _page_number(entry, fallback_page), entry


def _page_number(item: Mapping[str, Any], fallback: int) -> int:
    if item.get("page_idx") is not None:
        return int(item["page_idx"]) + 1
    if item.get("page_index") is not None:
        return max(1, int(item["page_index"]))
    return fallback


def _blocks_from_markdown(
    markdown: str,
    files: Mapping[str, bytes],
    *,
    reading_order_start: int,
) -> tuple[DocumentBlock, ...]:
    blocks: list[DocumentBlock] = []
    sections: list[str] = []
    reading_order = reading_order_start
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal reading_order
        if not paragraph_lines:
            return
        reading_order += 1
        text = clean_text("\n".join(paragraph_lines))
        asset_refs = _resolved_asset_refs(
            _IMAGE_PATTERN.findall("\n".join(paragraph_lines)), files
        )
        blocks.append(
            DocumentBlock(
                block_id=_block_id(
                    reading_order=reading_order,
                    page_start=None,
                    block_type="paragraph",
                    section_path=tuple(sections),
                    text=text,
                    asset_refs=asset_refs,
                ),
                type="paragraph",
                text=text,
                markdown="\n".join(paragraph_lines).strip(),
                section_path=tuple(sections),
                asset_refs=asset_refs,
                reading_order=reading_order,
            )
        )
        paragraph_lines.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        heading_match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading_match:
            flush_paragraph()
            level = len(heading_match.group(1))
            text = clean_text(heading_match.group(2))
            sections = _next_section_path(sections, text, level)
            reading_order += 1
            blocks.append(
                DocumentBlock(
                    block_id=_block_id(
                        reading_order=reading_order,
                        page_start=None,
                        block_type="heading",
                        section_path=tuple(sections),
                        text=text,
                        asset_refs=(),
                    ),
                    type="heading",
                    text=text,
                    markdown=line,
                    section_path=tuple(sections),
                    reading_order=reading_order,
                    metadata={"level": level, "raw_type": "markdown_heading"},
                )
            )
            continue
        if line.strip():
            paragraph_lines.append(line)
            continue
        flush_paragraph()

    flush_paragraph()
    return tuple(blocks)


def _materialize_v2_block(
    raw_type: str, item: Mapping[str, Any]
) -> tuple[str, str, str, dict[str, Any]]:
    content = item.get("content")
    content_map = content if isinstance(content, Mapping) else {}
    metadata: dict[str, Any] = {"raw_type": raw_type}
    anchor = item.get("anchor")
    if isinstance(anchor, str) and anchor:
        metadata["anchor"] = anchor
    sub_type = item.get("sub_type")
    if isinstance(sub_type, str) and sub_type:
        metadata["sub_type"] = sub_type

    if raw_type == "title":
        text = _inline_text(content_map.get("title_content"))
        level = max(1, int(content_map.get("level", 1)))
        metadata["level"] = level
        return "heading", text, f"{'#' * level} {text}".strip(), metadata
    if raw_type == "paragraph":
        text = clean_text(_inline_text(content_map.get("paragraph_content")))
        return "paragraph", text, text, metadata
    if raw_type in {"list", "index"}:
        items = _list_items_text(content_map.get("list_items"))
        text = clean_text("\n".join(items))
        markdown = "\n".join(f"- {entry}" for entry in items if entry)
        return "list", text, markdown or text, metadata
    if raw_type == "equation_interline":
        text = _inline_text(content_map.get("math_content"))
        markdown = text if text.startswith("$$") else f"$$\n{text}\n$$"
        metadata["math_type"] = content_map.get("math_type", "")
        return "equation", text.strip(), markdown.strip(), metadata
    if raw_type in {"code", "algorithm"}:
        body_key = "code_content" if raw_type == "code" else "algorithm_content"
        text = _inline_text(content_map.get(body_key))
        language = str(content_map.get("code_language") or "").strip()
        caption = _inline_text(
            content_map.get("code_caption") or content_map.get("algorithm_caption")
        )
        footnote = _inline_text(
            content_map.get("code_footnote") or content_map.get("algorithm_footnote")
        )
        parts = [part for part in (caption, text, footnote) if part]
        markdown = f"```{language}\n{text}\n```".strip() if text else ""
        metadata["language"] = language
        return "code", "\n\n".join(parts).strip(), markdown, metadata
    if raw_type in {"image", "table", "chart"}:
        return _materialize_visual_block(raw_type, content_map, metadata)

    text = clean_text(_inline_text(content_map))
    return "paragraph", text, text, metadata


def _materialize_visual_block(
    raw_type: str, content_map: Mapping[str, Any], metadata: dict[str, Any]
) -> tuple[str, str, str, dict[str, Any]]:
    caption = _inline_text(
        content_map.get("image_caption")
        or content_map.get("table_caption")
        or content_map.get("chart_caption")
        or content_map.get("caption")
    )
    footnote = _inline_text(
        content_map.get("image_footnote")
        or content_map.get("table_footnote")
        or content_map.get("chart_footnote")
        or content_map.get("footnote")
    )
    body = _inline_text(
        content_map.get("table_body")
        or content_map.get("content")
        or content_map.get("chart_body")
    )
    asset_path = str(
        content_map.get("img_path")
        or content_map.get("image_path")
        or content_map.get("path")
        or ""
    ).strip()
    parts = [part for part in (caption, body, footnote) if part]
    text = clean_text("\n\n".join(parts).strip())
    if raw_type == "table" and body:
        markdown = body.strip()
    else:
        markdown = (
            f"![{caption or raw_type}]({asset_path})".strip() if asset_path else text
        )
        if body:
            markdown = f"{markdown}\n\n{body}".strip()
        if footnote:
            markdown = f"{markdown}\n\n{footnote}".strip()
    return raw_type, text, markdown, metadata


def _next_section_path(current: list[str], title: str, level: int) -> list[str]:
    base = current[: max(level - 1, 0)]
    return [*base, title]


def _inline_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return clean_text("".join(_inline_text(entry) for entry in value))
    if isinstance(value, Mapping):
        entry_type = str(value.get("type") or "")
        if entry_type == "hyperlink":
            children = value.get("children")
            if children is not None:
                return _inline_text(children)
            return clean_text(str(value.get("content") or ""))
        for key in ("content", "text", "value"):
            field = value.get(key)
            if field is not None:
                return _inline_text(field)
        return clean_text(" ".join(_inline_text(entry) for entry in value.values()))
    return clean_text(str(value))


def _list_items_text(value: Any) -> list[str]:
    if not isinstance(value, list):
        text = _inline_text(value)
        return [text] if text else []
    items: list[str] = []
    for entry in value:
        text = _inline_text(entry)
        if text:
            items.append(text)
    return items


def _bbox_tuple(value: Any) -> tuple[tuple[float, float, float, float], ...]:
    if not isinstance(value, list):
        return ()
    boxes = value if value and isinstance(value[0], list) else [value]
    parsed: list[tuple[float, float, float, float]] = []
    try:
        for box in boxes:
            if not isinstance(box, list) or len(box) != 4:
                continue
            parsed.append((float(box[0]), float(box[1]), float(box[2]), float(box[3])))
    except (TypeError, ValueError):
        return ()
    return tuple(parsed)


def _asset_refs_from_mapping(
    item: Mapping[str, Any], files: Mapping[str, bytes]
) -> tuple[str, ...]:
    refs: list[str] = []

    def visit(value: Any, *, key: str = "") -> None:
        if isinstance(value, Mapping):
            for nested_key, nested_value in value.items():
                visit(nested_value, key=nested_key)
            return
        if isinstance(value, list):
            for nested_value in value:
                visit(nested_value, key=key)
            return
        if not isinstance(value, str):
            return
        if key not in {"img_path", "image_path", "path"}:
            return
        try:
            normalized = _normalize_asset_ref(value)
        except NormalizationError:
            return
        if (
            normalized
            and normalized not in refs
            and resolve_archive_file(files, normalized)
        ):
            refs.append(normalized)

    visit(item)
    return tuple(refs)


def _resolved_asset_refs(
    values: Iterable[str], files: Mapping[str, bytes]
) -> tuple[str, ...]:
    refs: list[str] = []
    for value in values:
        try:
            normalized = _normalize_asset_ref(value)
        except NormalizationError:
            continue
        if normalized not in refs and resolve_archive_file(files, normalized):
            refs.append(normalized)
    return tuple(refs)


def _normalize_asset_ref(value: str) -> str:
    normalized = value.strip()
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized:
        raise NormalizationError("empty archive asset reference")
    return _safe_member_name(normalized)


def _block_id(
    *,
    reading_order: int,
    page_start: int | None,
    block_type: str,
    section_path: tuple[str, ...],
    text: str,
    asset_refs: tuple[str, ...],
) -> str:
    digest = sha1(
        "\x1f".join(
            [
                str(reading_order),
                str(page_start),
                block_type,
                "/".join(section_path),
                text,
                "|".join(asset_refs),
            ]
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"blk_{digest}"
