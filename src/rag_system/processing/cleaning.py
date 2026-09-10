from __future__ import annotations

import re
import unicodedata
from collections import Counter


_PAGE_NUMBER = re.compile(r"^(?:page\s+)?\d+(?:\s*(?:/|of)\s*\d+)?$", re.IGNORECASE)


def _normalise_line(line: str) -> str:
    line = line.replace("\u00a0", " ").replace("\u200b", "")
    return re.sub(r"[ \t]+", " ", line).strip()


def clean_text(text: str) -> str:
    """Normalize extracted text and remove repeated page furniture.

    Form-feed boundaries are kept long enough to identify headers and footers,
    then converted to paragraph breaks. This makes PDF extraction less noisy
    without deleting legitimate content that appears only once.
    """

    normalized = (
        unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    )
    normalized = normalized.replace("\x00", "")
    pages = normalized.split("\f")
    page_lines: list[list[str]] = []
    for page in pages:
        lines = [_normalise_line(line) for line in page.split("\n")]
        page_lines.append([line for line in lines if line])

    repeated_candidates: list[str] = []
    if len(page_lines) > 1:
        edge_lines = []
        for lines in page_lines:
            edge_lines.extend(lines[:2])
            edge_lines.extend(lines[-2:])
        counts = Counter(edge_lines)
        threshold = max(2, (len(page_lines) + 1) // 2)
        repeated_candidates = [
            line
            for line, count in counts.items()
            if count >= threshold and len(line) <= 120
        ]

    output: list[str] = []
    previous = None
    for lines in page_lines:
        for line in lines:
            if line in repeated_candidates or _PAGE_NUMBER.fullmatch(line):
                continue
            if line == previous:
                continue
            output.append(line)
            previous = line
        if output and output[-1] != "":
            output.append("")

    while output and output[-1] == "":
        output.pop()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(output)).strip()
