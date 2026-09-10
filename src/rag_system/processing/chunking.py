from __future__ import annotations

from collections.abc import Iterable
from hashlib import sha1

from ..domain.models import Chunk, DocumentBlock, DocumentRevision


CHUNKING_VERSION = "header-path-v1"
HEADER_PATH_SEPARATOR = " > "


def format_header_path(section_path: Iterable[str]) -> str:
    return HEADER_PATH_SEPARATOR.join(title for title in section_path if title)


def retrieval_text_for_chunk(chunk: Chunk, body: str | None = None) -> str:
    """Add the complete header path to retrieval-only chunk text."""

    content = chunk.content if body is None else body
    header_path = format_header_path(chunk.section_path)
    return f"[{header_path}]\n\n{content}" if header_path else content


def _boundary_before(text: str, start: int, end: int) -> int:
    """Prefer a paragraph/sentence boundary while retaining a hard limit."""

    window_start = start + (end - start) // 2
    candidates = [
        text.rfind(marker, window_start, end)
        for marker in ("\n\n", "\n", ". ", "! ", "? ", "。", "！", "？")
    ]
    candidates = [
        candidate + (2 if text[candidate : candidate + 2] == "\n\n" else 1)
        for candidate in candidates
        if candidate >= window_start
    ]
    return max(candidates, default=end)


def estimate_tokens(text: str) -> int:
    """Estimate tokens without assuming a provider-specific tokenizer.

    The estimate is deliberately provider-neutral. Han characters and other
    non-ASCII symbols count as one token each; ASCII alphanumeric runs count
    one token per roughly four characters with a one-token minimum; and
    punctuation runs count one token per roughly two characters. Ordinary
    spaces are separators, while structural whitespace costs one token per
    run. The same quarter-token units are used by the text splitter below.
    """

    units = sum(_token_units_for_text(text.strip()))
    return (units + 3) // 4


def split_text_by_tokens(
    text: str,
    *,
    max_tokens: int,
    overlap_tokens: int,
) -> list[str]:
    if max_tokens < 1:
        raise ValueError("max_tokens must be positive")
    if not 0 <= overlap_tokens < max_tokens:
        raise ValueError("overlap_tokens must be in [0, max_tokens)")
    text = text.strip()
    if not text:
        return []
    if estimate_tokens(text) <= max_tokens:
        return [text]

    weights = _token_units_for_text(text)
    budget = max_tokens * 4
    overlap_budget = overlap_tokens * 4
    chunks: list[str] = []
    start = 0
    while start < len(text):
        proposed_end = _end_for_unit_budget(weights, start, budget)
        if proposed_end >= len(text):
            end = len(text)
        else:
            end = _boundary_before(text, start, proposed_end)
            if end <= start:
                end = proposed_end
        end = _fit_end_to_token_budget(text, start, end, max_tokens)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        next_start = _start_for_overlap(weights, end, overlap_budget)
        next_start = max(start + 1, next_start)
        while next_start < len(text) and text[next_start].isspace():
            next_start += 1
        start = next_start
    return chunks


def chunk_document(
    revision: DocumentRevision,
    *,
    embedding_profile_id: str,
    chunking_version: str = CHUNKING_VERSION,
    max_tokens: int = 512,
    overlap_tokens: int = 64,
) -> tuple[Chunk, ...]:
    """Create deterministic, section-aware chunks from normalized blocks."""

    if not embedding_profile_id:
        raise ValueError("embedding_profile_id is required")
    if max_tokens < 32:
        raise ValueError("max_tokens must be at least 32")
    if not 0 <= overlap_tokens < max_tokens:
        raise ValueError("overlap_tokens must be in [0, max_tokens)")

    chunks: list[Chunk] = []
    buffer: list[DocumentBlock] = []
    current_section: tuple[str, ...] | None = None
    ordinal = 0

    def flush(*, carry_overlap: bool) -> None:
        nonlocal buffer, ordinal
        if not buffer:
            return
        ordinal += 1
        chunks.append(
            _build_chunk(
                revision,
                buffer,
                ordinal=ordinal,
                embedding_profile_id=embedding_profile_id,
                chunking_version=chunking_version,
            )
        )
        if carry_overlap:
            buffer = _overlap_tail(buffer, overlap_tokens)
        else:
            buffer = []

    for block in sorted(revision.blocks, key=lambda item: item.reading_order):
        rendered = _render_block(block)
        if not rendered:
            continue

        if current_section is None:
            current_section = block.section_path
        elif block.section_path != current_section:
            if buffer and all(item.type == "heading" for item in buffer):
                buffer = []
            else:
                flush(carry_overlap=False)
            current_section = block.section_path

        if estimate_tokens(rendered) > max_tokens and block.type not in {
            "table",
            "equation",
            "code",
            "image",
            "chart",
        }:
            carry_heading = len(buffer) == 1 and buffer[0].type == "heading"
            heading_block = buffer[0] if carry_heading else None
            heading_prefix = (
                _render_block(heading_block).strip() if heading_block else ""
            )
            if carry_heading:
                buffer = []
            else:
                flush(carry_overlap=False)

            part_size = max_tokens
            if heading_prefix:
                part_size = max(1, max_tokens - estimate_tokens(heading_prefix) - 2)

            parts = split_text_by_tokens(
                rendered,
                max_tokens=part_size,
                overlap_tokens=min(overlap_tokens, part_size - 1),
            )
            for index, part in enumerate(parts):
                content = part
                block_list = [block]
                if index == 0 and heading_prefix:
                    content = f"{heading_prefix}\n\n{part}".strip()
                    block_list = [heading_block, block] if heading_block else block_list
                ordinal += 1
                chunks.append(
                    _build_chunk(
                        revision,
                        block_list,
                        ordinal=ordinal,
                        embedding_profile_id=embedding_profile_id,
                        chunking_version=chunking_version,
                        content_override=content,
                    )
                )
            continue

        projected = estimate_tokens(_join_block_content([*buffer, block]))
        if (
            buffer
            and projected > max_tokens
            and not (len(buffer) == 1 and buffer[0].type == "heading")
        ):
            flush(carry_overlap=True)
            if (
                buffer
                and estimate_tokens(_join_block_content([*buffer, block])) > max_tokens
            ):
                buffer = []
        buffer.append(block)

    flush(carry_overlap=False)
    return tuple(chunks)


def _build_chunk(
    revision: DocumentRevision,
    blocks: Iterable[DocumentBlock],
    *,
    ordinal: int,
    embedding_profile_id: str,
    chunking_version: str,
    content_override: str | None = None,
) -> Chunk:
    block_list = list(blocks)
    section_path = block_list[0].section_path if block_list else ()
    content = content_override or _join_block_content(block_list)
    block_ids = tuple(block.block_id for block in block_list)
    asset_refs = _dedupe(ref for block in block_list for ref in block.asset_refs)
    pages_start = [
        block.page_start for block in block_list if block.page_start is not None
    ]
    pages_end = [block.page_end for block in block_list if block.page_end is not None]
    chunk_id = _chunk_id(
        revision.document_revision_id,
        chunking_version,
        ordinal,
        content,
        block_ids,
    )
    return Chunk(
        chunk_id=chunk_id,
        document_id=revision.document_id,
        document_revision_id=revision.document_revision_id,
        knowledge_base_id=revision.knowledge_base_id,
        title=revision.title,
        content=content,
        section_path=section_path,
        page_start=min(pages_start) if pages_start else None,
        page_end=max(pages_end) if pages_end else None,
        block_ids=block_ids,
        asset_refs=asset_refs,
        source_object_key=revision.source_object_key,
        embedding_profile_id=embedding_profile_id,
        chunking_version=chunking_version,
        metadata={
            "header_path": list(section_path),
            "header_path_text": format_header_path(section_path),
            "block_types": [block.type for block in block_list],
            "chunk_ordinal": ordinal,
        },
        created_at=revision.created_at,
    )


def _render_block(block: DocumentBlock) -> str:
    return (block.markdown or block.text).strip()


def _join_block_content(blocks: Iterable[DocumentBlock]) -> str:
    return "\n\n".join(filter(None, (_render_block(block) for block in blocks))).strip()


def _overlap_tail(
    blocks: list[DocumentBlock], overlap_tokens: int
) -> list[DocumentBlock]:
    if overlap_tokens == 0:
        return []
    tail: list[DocumentBlock] = []
    remaining = overlap_tokens
    for block in reversed(blocks):
        size = estimate_tokens(_render_block(block))
        if size > remaining:
            break
        tail.append(block)
        remaining -= size
        if remaining <= 0:
            break
    tail.reverse()
    return tail


def _chunk_id(
    document_revision_id: str,
    chunking_version: str,
    ordinal: int,
    content: str,
    block_ids: tuple[str, ...],
) -> str:
    digest = sha1(
        "\x1f".join(
            [
                document_revision_id,
                chunking_version,
                str(ordinal),
                content,
                "|".join(block_ids),
            ]
        ).encode("utf-8")
    ).hexdigest()[:20]
    return f"chunk_{digest}"


def _dedupe(values: Iterable[str]) -> tuple[str, ...]:
    ordered: list[str] = []
    for value in values:
        if value not in ordered:
            ordered.append(value)
    return tuple(ordered)


def _token_units_for_text(text: str) -> list[int]:
    """Return context-aware quarter-token weights for each character.

    Segment totals are rounded before they are assigned to characters. The
    weights are therefore suitable for the greedy splitter while preserving
    the same estimate when a complete segment is measured independently.
    """

    units = [0] * len(text)
    index = 0
    while index < len(text):
        character = text[index]

        if character.isspace():
            end = index + 1
            while end < len(text) and text[end].isspace():
                end += 1
            # A normal single space is part of the surrounding lexical token.
            # Newlines, tabs, or repeated spaces represent structural spacing.
            if end - index > 1 or character != " ":
                _assign_segment_units(units, index, end, 4)
            index = end
            continue

        if character.isascii() and character.isalnum():
            end = index + 1
            while end < len(text) and text[end].isascii() and text[end].isalnum():
                end += 1
            token_count = max(1, (end - index + 2) // 4)
            _assign_segment_units(units, index, end, token_count * 4)
            index = end
            continue

        if character.isascii():
            end = index + 1
            while (
                end < len(text)
                and text[end].isascii()
                and not (text[end].isalnum() or text[end].isspace())
            ):
                end += 1
            token_count = max(1, (end - index + 1) // 2)
            _assign_segment_units(units, index, end, token_count * 4)
            index = end
            continue

        # Han, accented letters, emoji, and other non-ASCII symbols are kept
        # conservative because the active provider tokenizer is not known here.
        units[index] = 4
        index += 1

    return units


def _assign_segment_units(units: list[int], start: int, end: int, total: int) -> None:
    length = end - start
    base, remainder = divmod(total, length)
    for offset in range(length):
        units[start + offset] = base + (1 if offset < remainder else 0)


def _fit_end_to_token_budget(text: str, start: int, end: int, max_tokens: int) -> int:
    """Recheck a split boundary using the standalone chunk estimate."""

    while end > start + 1:
        candidate = text[start:end].strip()
        if estimate_tokens(candidate) <= max_tokens:
            return end

        whitespace = max(
            text.rfind(marker, start + 1, end) for marker in (" ", "\t", "\n", "\r")
        )
        end = whitespace if whitespace > start else end - 1
    return max(start + 1, end)


def _end_for_unit_budget(weights: list[int], start: int, budget: int) -> int:
    total = 0
    end = start
    while end < len(weights) and total + weights[end] <= budget:
        total += weights[end]
        end += 1
    return max(start + 1, end)


def _start_for_overlap(weights: list[int], end: int, budget: int) -> int:
    if budget == 0:
        return end
    total = 0
    start = end
    while start > 0 and total + weights[start - 1] <= budget:
        start -= 1
        total += weights[start]
    return start
