from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
import io
import json
from zipfile import ZipFile

import pytest

from rag_system.processing.chunking import (
    CHUNKING_VERSION,
    chunk_document,
    estimate_tokens,
    retrieval_text_for_chunk,
    split_text_by_tokens,
)
from rag_system.domain.models import DocumentBlock, DocumentRevision
from rag_system.processing.normalization import (
    NormalizationError,
    derive_title,
    normalize_mineru_archive,
)


def _zip_bytes(members: dict[str, str | bytes]) -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    return buffer.getvalue()


def test_normalize_content_list_v2_preserves_sections_pages_and_assets() -> None:
    archive = _zip_bytes(
        {
            "content_list_v2.json": json.dumps(
                [
                    [
                        {
                            "type": "title",
                            "content": {
                                "title_content": [
                                    {"type": "text", "content": "1 Introduction"}
                                ],
                                "level": 1,
                            },
                            "bbox": [10, 20, 30, 40],
                        },
                        {
                            "type": "paragraph",
                            "content": {
                                "paragraph_content": [
                                    {"type": "text", "content": "First paragraph."}
                                ]
                            },
                        },
                        {
                            "type": "table",
                            "content": {
                                "img_path": "images/table-1.png",
                                "table_caption": [
                                    {"type": "text", "content": "Table 1. Results"}
                                ],
                                "table_body": "<table><tr><td>A</td></tr></table>",
                            },
                        },
                    ],
                    [
                        {
                            "type": "paragraph",
                            "content": {
                                "paragraph_content": [
                                    {"type": "text", "content": "Second page text."}
                                ]
                            },
                        }
                    ],
                ]
            ),
            "images/table-1.png": b"png",
        }
    )

    blocks = normalize_mineru_archive(archive, max_bytes=1024 * 1024)

    assert [block.type for block in blocks] == [
        "heading",
        "paragraph",
        "table",
        "paragraph",
    ]
    assert blocks[0].section_path == ("1 Introduction",)
    assert blocks[1].section_path == ("1 Introduction",)
    assert blocks[2].asset_refs == ("images/table-1.png",)
    assert blocks[0].page_start == 1
    assert blocks[3].page_start == 2
    assert derive_title(blocks) == "1 Introduction"


def test_normalize_content_list_v2_preserves_nested_header_path() -> None:
    archive = _zip_bytes(
        {
            "content_list_v2.json": json.dumps(
                [
                    {
                        "type": "title",
                        "content": {"title_content": "Handbook", "level": 1},
                    },
                    {
                        "type": "title",
                        "content": {"title_content": "Operations", "level": 2},
                    },
                    {
                        "type": "title",
                        "content": {"title_content": "Linux", "level": 3},
                    },
                    {
                        "type": "paragraph",
                        "content": {"paragraph_content": "Rotate the key."},
                    },
                ]
            )
        }
    )

    blocks = normalize_mineru_archive(archive, max_bytes=1024 * 1024)

    assert blocks[-1].section_path == ("Handbook", "Operations", "Linux")


def test_normalize_falls_back_to_full_markdown() -> None:
    archive = _zip_bytes(
        {
            "full.md": "# Title\n\nIntro paragraph.\n\n![figure](images/chart.png)\n",
            "images/chart.png": b"png",
        }
    )

    blocks = normalize_mineru_archive(archive, max_bytes=1024 * 1024)

    assert [block.type for block in blocks] == ["heading", "paragraph", "paragraph"]
    assert blocks[0].text == "Title"
    assert blocks[2].asset_refs == ("images/chart.png",)
    assert blocks[1].section_path == ("Title",)


def test_normalize_preserves_complete_nested_header_path() -> None:
    archive = _zip_bytes(
        {"full.md": ("# Handbook\n\n## Operations\n\n### Linux\n\nRotate the key.\n")}
    )

    blocks = normalize_mineru_archive(archive, max_bytes=1024 * 1024)

    assert blocks[-1].type == "paragraph"
    assert blocks[-1].section_path == ("Handbook", "Operations", "Linux")


def test_normalize_v2_accepts_flat_page_indexed_blocks() -> None:
    archive = _zip_bytes(
        {
            "content_list_v2.json": json.dumps(
                [
                    {
                        "type": "title",
                        "page_idx": 0,
                        "content": {
                            "title_content": [{"type": "text", "content": "Title"}],
                            "level": 1,
                        },
                    },
                    {
                        "type": "paragraph",
                        "page_idx": 2,
                        "content": {
                            "paragraph_content": [
                                {"type": "text", "content": "Page three"}
                            ]
                        },
                    },
                ]
            )
        }
    )

    blocks = normalize_mineru_archive(archive, max_bytes=1024 * 1024)

    assert [block.page_start for block in blocks] == [1, 3]
    assert blocks[1].section_path == ("Title",)


def test_normalize_rejects_zip_slip_and_oversize() -> None:
    zip_slip = _zip_bytes({"../evil.txt": "bad"})
    with pytest.raises(NormalizationError, match="unsafe zip member"):
        normalize_mineru_archive(zip_slip, max_bytes=1024)

    windows_zip_slip = _zip_bytes({r"..\evil.txt": "bad"})
    with pytest.raises(NormalizationError, match="unsafe zip member"):
        normalize_mineru_archive(windows_zip_slip, max_bytes=1024)

    oversized = _zip_bytes({"content_list_v2.json": "x" * 2048})
    with pytest.raises(NormalizationError, match="exceeded max_bytes"):
        normalize_mineru_archive(oversized, max_bytes=32)


def test_normalize_rejects_legacy_content_list() -> None:
    archive = _zip_bytes(
        {"content_list.json": json.dumps([{"type": "text", "text": "legacy"}])}
    )

    with pytest.raises(NormalizationError, match="content_list_v2.json or full.md"):
        normalize_mineru_archive(archive, max_bytes=1024)


def test_chunk_document_is_structure_aware_and_deterministic() -> None:
    revision = DocumentRevision(
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        source_sha256="sha256",
        source_object_key="knowledge-bases/kb-1/documents/doc-1/revisions/rev-1/raw/source",
        source_name="source.pdf",
        title="Title",
        parser_provider="mineru",
        parser_version="remote",
        blocks=(
            DocumentBlock(
                block_id="b1",
                type="heading",
                text="Section A",
                markdown="# Section A",
                section_path=("Section A",),
                reading_order=1,
            ),
            DocumentBlock(
                block_id="b2",
                type="paragraph",
                text="alpha " * 15,
                markdown="alpha " * 15,
                section_path=("Section A",),
                page_start=1,
                page_end=1,
                reading_order=2,
            ),
            DocumentBlock(
                block_id="b3",
                type="table",
                text="Table 1",
                markdown="<table><tr><td>x</td></tr></table>",
                section_path=("Section A",),
                page_start=1,
                page_end=1,
                asset_refs=("images/table.png",),
                reading_order=3,
            ),
            DocumentBlock(
                block_id="b4",
                type="heading",
                text="Section B",
                markdown="# Section B",
                section_path=("Section B",),
                reading_order=4,
            ),
            DocumentBlock(
                block_id="b5",
                type="paragraph",
                text="beta " * 8,
                markdown="beta " * 8,
                section_path=("Section B",),
                page_start=2,
                page_end=2,
                reading_order=5,
            ),
        ),
        created_at=datetime(2026, 7, 23, tzinfo=UTC),
    )

    chunks_first = chunk_document(
        revision,
        embedding_profile_id="openai-compatible:test:1024:cosine:v1",
        max_tokens=80,
        overlap_tokens=10,
    )
    chunks_second = chunk_document(
        revision,
        embedding_profile_id="openai-compatible:test:1024:cosine:v1",
        max_tokens=80,
        overlap_tokens=10,
    )

    assert [chunk.section_path for chunk in chunks_first] == [
        ("Section A",),
        ("Section B",),
    ]
    assert chunks_first[0].block_ids == ("b1", "b2", "b3")
    assert chunks_first[0].asset_refs == ("images/table.png",)
    assert [chunk.chunk_id for chunk in chunks_first] == [
        chunk.chunk_id for chunk in chunks_second
    ]
    assert all(chunk.chunking_version == CHUNKING_VERSION for chunk in chunks_first)


def test_chunk_preserves_header_path_metadata_and_raw_content() -> None:
    revision = DocumentRevision(
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        source_sha256="sha256",
        source_object_key="raw/source",
        source_name="source.md",
        title="Handbook",
        parser_provider="mineru",
        parser_version="remote",
        blocks=(
            DocumentBlock(
                block_id="b1",
                type="paragraph",
                text="Rotate the key.",
                section_path=("Handbook", "Operations", "Linux"),
                reading_order=1,
            ),
        ),
    )

    chunk = chunk_document(revision, embedding_profile_id="profile")[0]

    assert chunk.content == "Rotate the key."
    assert chunk.section_path == ("Handbook", "Operations", "Linux")
    assert chunk.metadata["header_path"] == ["Handbook", "Operations", "Linux"]
    assert chunk.metadata["header_path_text"] == "Handbook > Operations > Linux"
    assert retrieval_text_for_chunk(chunk) == (
        "[Handbook > Operations > Linux]\n\nRotate the key."
    )


def test_chunk_drops_heading_only_ancestors_but_keeps_their_path() -> None:
    blocks = (
        DocumentBlock(
            block_id="h1",
            type="heading",
            text="Handbook",
            section_path=("Handbook",),
            reading_order=1,
        ),
        DocumentBlock(
            block_id="h2",
            type="heading",
            text="Operations",
            section_path=("Handbook", "Operations"),
            reading_order=2,
        ),
        DocumentBlock(
            block_id="h3",
            type="heading",
            text="Linux",
            section_path=("Handbook", "Operations", "Linux"),
            reading_order=3,
        ),
        DocumentBlock(
            block_id="p1",
            type="paragraph",
            text="Rotate the key.",
            section_path=("Handbook", "Operations", "Linux"),
            reading_order=4,
        ),
    )
    revision = DocumentRevision(
        document_id="doc-1",
        document_revision_id="rev-1",
        knowledge_base_id="kb-1",
        source_sha256="sha256",
        source_object_key="raw/source",
        source_name="source.md",
        title="Handbook",
        parser_provider="mineru",
        parser_version="remote",
        blocks=blocks,
    )

    chunks = chunk_document(revision, embedding_profile_id="profile")

    assert len(chunks) == 1
    assert chunks[0].block_ids == ("h3", "p1")
    assert chunks[0].section_path == ("Handbook", "Operations", "Linux")

    heading_only = chunk_document(
        replace(revision, blocks=blocks[:3]), embedding_profile_id="profile"
    )
    assert len(heading_only) == 1
    assert heading_only[0].block_ids == ("h3",)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("知识库", 3),
        ("abcdefgh", 2),
        ("hello world", 2),
        ("hello世界", 3),
        ("a b c", 3),
        ("hello\nworld", 3),
        ("hello   world", 3),
        ("https://example.com/a", 9),
    ],
)
def test_token_estimate_handles_mixed_text_and_long_ascii_runs(
    text: str, expected: int
) -> None:
    assert estimate_tokens(text) == expected


def test_token_budget_handles_cjk_and_ascii_without_character_semantics() -> None:
    assert estimate_tokens("知识库") == 3
    assert estimate_tokens("abcdefgh") == 2

    parts = split_text_by_tokens(
        "知识库检索能力。" * 40 + " alpha beta gamma" * 40,
        max_tokens=32,
        overlap_tokens=4,
    )

    assert len(parts) > 2
    assert all(estimate_tokens(part) <= 32 for part in parts)
