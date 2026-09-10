# RAG v1 construction work items

The [specification](spec.md) owns product acceptance outcomes. The
[module map](../../docs/design/rag-v1/README.md) owns responsibilities and
interfaces. These 17 work items are vertical delivery slices selected under the
user's routine-design/decomposition delegation on 2026-09-10.

All tickets are scoped as `ready-for-agent`; none is implemented or claimed.
Implementation still starts from an explicit execution request. A readiness
label is neither user acceptance of measured quality nor a request to run tools
against production. The current starting frontier is **01**.

## Dependency map

| Work item | Blocked by | Modules touched |
| --- | --- | --- |
| [01 Run a bounded evidence-tool turn in the browser](issues/01-bounded-forge-turn.md) | None | M07, M06, M09 |
| [02 Persist conversations and settle cancellation correctly](issues/02-durable-conversations.md) | 01 | M07, M08, M09 |
| [03 Apply organization access and project scope to knowledge operations](issues/03-organization-access.md) | 02 | M01, M07, M09 |
| [04 Import Markdown and inspect versioned original passages](issues/04-markdown-sources.md) | 03 | M02, M08, M09 |
| [05 Answer fact questions from hybrid original-source retrieval](issues/05-source-grounded-answers.md) | 04 | M02, M06, M07, M09 |
| [06 Update a document and switch current evidence atomically](issues/06-source-version-activation.md) | 05 | M02, M06, M08, M09 |
| [07 Resolve entity identities with inspectable source evidence](issues/07-evidence-based-identities.md) | 04 | M02, M03, M08, M09 |
| [08 Publish cited cross-document topic Wiki pages](issues/08-topic-wiki.md) | 06, 07 | M02, M03, M05, M06, M08, M09 |
| [09 Refresh Wiki after source changes and natural-language corrections](issues/09-wiki-refresh-corrections.md) | 08 | M02, M03, M05, M06, M08, M09 |
| [10 Merge, split and restore Wiki pages with traceable navigation](issues/10-wiki-restructure-restore.md) | 09 | M05, M06, M08, M09 |
| [11 Retrieve source-backed qualified graph relationships](issues/11-qualified-graph.md) | 06, 07 | M02, M03, M04, M06, M08, M09 |
| [12 Answer multi-hop questions with bounded adaptive retrieval](issues/12-bounded-multihop.md) | 08, 11 | M03, M04, M05, M06, M07, M09 |
| [13 Resolve natural-language source and Wiki requests across turns](issues/13-contextual-source-intent.md) | 06, 09 | M01, M02, M05, M07, M08, M09 |
| [14 Expose organization-scoped evidence and answers through MCP](issues/14-external-evidence-mcp.md) | 05 | M01, M06, M07, M09 |
| [15 Recover interrupted maintenance without duplicate or stale effects](issues/15-maintenance-recovery.md) | 09, 10, 11, 13 | M02, M03, M04, M05, M07, M08, M09 |
| [16 Build reproducible evaluation over public answer interfaces](issues/16-evaluation-harness.md) | 05 | M06, M09 |
| [17 Run acceptance and capacity comparisons on a frozen corpus](issues/17-acceptance-capacity.md) | 10, 12, 13, 14, 15, 16 | M01, M02, M03, M04, M05, M06, M07, M08, M09 |

```mermaid
flowchart TD
    T01 --> T02
    T02 --> T03
    T03 --> T04
    T04 --> T05
    T05 --> T06
    T04 --> T07
    T06 --> T08
    T07 --> T08
    T08 --> T09
    T09 --> T10
    T06 --> T11
    T07 --> T11
    T08 --> T12
    T11 --> T12
    T06 --> T13
    T09 --> T13
    T05 --> T14
    T09 --> T15
    T10 --> T15
    T11 --> T15
    T13 --> T15
    T05 --> T16
    T10 --> T17
    T12 --> T17
    T13 --> T17
    T14 --> T17
    T15 --> T17
    T16 --> T17
```

The DAG expresses actual prerequisites, not a required single serial order.
After 04, identity work (07) can progress alongside retrieval/update work (05/06).
After 06/07, Wiki (08) and graph (11) have independent implementation paths.
MCP access (14) and the evaluation harness (16) need only source answering (05).
Combined multi-hop behavior (12) integrates the two knowledge routes.

## How to refine and implement

Review the common invariants before polishing a module in isolation. Start with
Sources' activation contract (M02), Evidence's final admission/finalization
contract (M06), and Agent Host's settlement/budget contract (M07); these determine
most cross-module behavior. Then inspect identity and Wiki/graph publication.

For implementation, select a ticket whose blockers are complete, read its
acceptance boundary and the linked module contracts, and use a fresh context for
that bounded task. Keep shared state changes sequential within their owners.
Add implementation-specific paths only once they exist; this plan specifies
behavior rather than assuming today's source layout.

Each ticket must demonstrate an end-to-end behavior, including the relevant
transport/view and persistence where introduced by that slice. Early development
fixtures are explicitly identified; later production-capable slices must replace
them at the same interfaces. The final assessment uses a frozen corpus and real
configured providers; it cannot be completed merely by replaying fixture tests.

## Scope and evidence

Routine granularity and dependencies are decided under Q36/Q39, so no repeated
ticket approval is required. Changes to confirmed product behavior must be
visible in the specification and discussion record. Upstream Forge issues remain
separate from this local backlog.

No product tests were run for this document change. Document links, acceptance
coverage and dependency structure are checked separately; executed ticket evidence
belongs in that ticket's Evidence section.
