---
status: accepted
date: 2026-09-10
---

# Shared source and entity identity for Wiki and graph derivation

Wiki and graph representations use shared entity identities and references to
original passages in specific source versions, while deriving their respective
content from original material. This permits both representations to preserve
their useful forms, locate content affected by source changes, and identify
repeated use of the same underlying evidence. The trade-off is maintaining
common identity and provenance conventions across both derivation workflows.

The graph is not required to be extracted from generated Wiki prose, which may
have omitted source details; the Wiki can retain explanations beyond the graph's
relationships. Referencing the same source in both representations does not
create independent corroboration. This decision does not select a graph library,
storage format, extraction algorithm, or synchronization mechanism, and has not
yet been implemented.
