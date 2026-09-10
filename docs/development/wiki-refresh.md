# Wiki refresh and corrections runtime

The #10 slice implements M05/P01–P08 using real PostgreSQL and a scripted model.
The tests establish lifecycle, bounded work, provenance and concurrency behavior;
they do not establish production semantic quality or corpus-scale latency.

Source activation queues discovery and, for updates, a historical reverse walk.
The walk records stable page-ID batches of 20 and includes deleted passages and
all project dependents of a shared source. Identity changes use the same page
queue. Discovery coalesces same-page intents, prepares its related updates and
creates, then publishes the edit set atomically. Mandatory work reuses the matching
current revision result. A failed discovery keeps its planned target-page work failed;
no peer publishes an independently prepared part of that edit set. Unrelated
mandatory work can settle while discovery coverage remains failed. Page work waits
for these streams; pages with identity dependencies also wait for
that operation's identity reconciliation. An original becomes searchable without
waiting for Wiki or graph work.

Page refresh reviews its retained descriptor, historical content and current
replacement originals through the existing six-window/seven-request inspection
ledger. It compares each retained factual claim, qualifiers and old original spans
against every bounded 4,000-byte current-source packet. Each comparison records
supported/absent/unresolved, supporting handles and range classification, with
two requests per claim/packet and the existing 120/45-second unit/request and 600-second
logical deadlines. These conservative UTF-8 byte caps remain below the token
budgets. Classification selects originals; publication still requires separate
generation and claim support review. A supported old claim prevents retirement
even when topic classification omits its paraphrased replacement. Before generating
independent blocks, every pair of source packets receives a bounded conflict check
(two requests per pair; at most 512 pairs per logical edit, otherwise actionable
failure). Conflicts receive a separate generated/reviewed block containing both
originals. Every reviewed source document, including
context-only inputs, becomes an authoritative freshness dependency.

Complete review with zero supported ranges can retire a page with
`no_current_support`. Model failure, unresolved identity, incomplete inspection
or unresolved classification cannot do so. Partial support publishes a reduced
version. Retired pages preserve their ID, descriptor, historical versions and
inbound links, leave active navigation/search, and can reactivate under the same
ID. Publication rechecks source/identity/page versions and worker fencing in the
transaction that writes the catalogue, page pointer and durable disposition.

Member contributions require the `correct` grant. Facts become immutable
`成员补充.md` source notes with the authenticated actor, scope and optional target;
they do not silently supersede another document's claim. Targeted notes invalidate
the old page as soon as their original activates. Organizational preferences are
retained routing guidance and never enter evidence packs. Exact normalized topic
titles/aliases resolve targets in the selected scope; a missing/ambiguous target
returns clarification without accepting a mutation. Broader conversational target
resolution remains the separately tracked #14 work.

The development provider recognizes `请纠正「日志保留」：生产日志保留 90 天。`
and `请记住整理偏好：优先按操作步骤整理。` as controlled natural-language fixtures.
The registered Forge tool accepts a verbatim substring of the current request,
uses host-established scope and records its durable operation in the run. These
phrases verify transport and tool behavior, not general intent understanding.

HTTP interfaces:

- `POST /api/wiki-contributions`: `key`, `kind` (`fact`/`guidance`), `text`,
  optional `target` title/alias and `projectId`.
- `GET /api/wiki-guidance`: retained actor/scope/guidance records.
- `GET /api/wiki-operations/:id`: aggregate readiness, per-page dispositions,
  dependency batches, required-job states, failure reasons and inspection ledger.
- `POST /api/wiki-operations/:id/repair`: `key`, revised `guidance`. A new
  attributable repair copies failed/deferred obligations into a linked operation;
  it preserves the original outcome. Retrying the same key/payload returns the
  same operation and budget. A changed payload with that key conflicts.

`/wiki-operations/:id` displays results and accepts explicit repair guidance.
Source receipts expose `source` and aggregate `wiki` readiness separately; optional
vector projection does not prevent successful content publication. A required
failure or pending continuation cannot be hidden by a successful discovery job.

Run `TEST_DATABASE_URL=… bun run test:wiki-refresh` against a disposable pgvector
PostgreSQL database. `test:wiki` covers the inherited discovery/inspection gates;
`test:browser` covers the conversational correction, original attribution and
clarification flow. Use `workOne(token)` for organization-partitioned test workers.
