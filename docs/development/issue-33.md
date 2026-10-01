# P04 execution evidence

Public multipart import commits immutable original bytes (file and directory
fsync), owner-scoped submission fingerprint, document/source/operation/attempt
identity, selected mode and captured index revision before acknowledgment.
Repeated acceptance returns the same identity; a changed payload under the key
fails with 409. A deliberate same-name upload is independent. A bounded process
worker extracts without using the browser signal. Originals remain available
independently of derived preparation; extraction alone never advertises QA ready.

PDF.js records physical pages, labels, rotation, raw text items/transforms/font
information, line/column order and candidate outlines. Recurrent margins are
removed only from navigation text. Original evidence retains qualifications and
headers/footers. Page tools read persisted artifacts rather than reparsing.
Raw Start routes enforce authorization and exact GET/HEAD/Range semantics;
Query owns library/status/detail caches and Form controls Flash/Standard import.
The original viewer uses PDF.js and immutable version URLs on both screen sizes.

Ran: typecheck/build, 3 Bun tests (39 assertions), 5 browser tests against an
independent real PostgreSQL database, inspected screenshots and canvas-pixel
checks at desktop 1440x900/mobile 390x844. Public acceptance tested all 12 frozen
fixtures, identical original bytes and exact range slices, deduplication/payload
conflict, same-name deliberate uploads, stored double-column/CJK content, viewer
return, anonymous 401, and explicit scanned/encrypted/malformed outcomes (3).
9 readable fixtures extracted; structural adequacy is the next gate.

The isolated pinned Python comparator ran with no model calls:
`LOREWEAVE_PAGEINDEX_REFERENCE=... bun run eval:reference`, then
`bun run eval:extraction`. `docs/evaluation/pageindex-reference.json` pins the
reference revision/package versions; `pageindex-extraction.json` pins all bytes.
All 9 extracted fixtures matched exact physical page counts and non-whitespace
character content. Spatial ordering differs from PyPDF2's content-stream order,
including margin placement; fixture-authored column order is the oracle.
PyPDF2's encrypted extraction hit its absent optional crypto dependency, which
is recorded, not interpreted as a product-policy comparison.

Not run: complete Flash/Standard publication or real-model quality. Why: P04 is
shared extraction/inspection. Risk: these synthetic fixtures establish concrete
layout cases, not general PDF coverage. Full mode trees, retry, evidence and the
fixed real-PDF evaluation still require their subsequent gates. No commit/push.
