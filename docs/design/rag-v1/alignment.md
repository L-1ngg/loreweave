# First construction alignment pass

Completed as document design on 2026-09-10. These refinements are selected under
the user's routine-design delegation and preserve the previously confirmed
product behavior. They are not executable verification results.

## Clarifications applied

| Ambiguity in the earlier blueprint | Aligned construction rule | Owner |
| --- | --- | --- |
| Knowledge maintenance combined identity, graph, Wiki and job policy in one broad module | Separate identity, graph, Wiki and durable operations; register handlers through the composition root | M03/M04/M05/M08 |
| Shared identities could accidentally make Wiki depend on complete graph extraction | Wiki and graph independently consume entity identity and original source evidence | M03 |
| Agent, retrieval and generation could each implement their own freshness check | Source/identity owners expose validity; M06 owns final evidence admission and records validated_at | C02/C05, M06 |
| SDK loop termination could leave no budget or well-defined route for the final cited answer | Use a distinct tools-disabled grounded generation call owned by M06 and charged to M07's shared budget | C05 |
| A source-change refresh might accidentally add a retrieval round after the cap | At most one refresh consumes an unused round and the original deadline; otherwise return a gap | C05 |
| Sentence-level stale-content bypass was implied without a dependency representation | Use source-version dependency manifests and conservative page bypass until revalidated; keep unrelated pages usable | C02 |
| HTTP timeout could release a slot while model/tool/persistence work still runs | Track response outcome and execution settlement separately, holding the slot/lease until settled | C04 |
| SDK history could be mistaken for transactional business-effect state | Domain effects and operation outcomes are transactional; missing SDK results trigger operation-key reconciliation | C03 |
| Delayed/out-of-order jobs could overwrite current derived content | Check source/page/identity revisions and worker fencing inside publication transactions | C07 |
| Technical modules were being treated as sequential delivery phases | Deliver vertical tickets; source-answering unlocks independent Wiki/graph/MCP/evaluation paths | Work-item DAG |

The module contracts own these rules. The overview and Forge reuse document link
to them so future changes have one callable-behavior authority.

## Examples used to align the boundaries

1. A new manual activates while a complex answer is being generated. M02 changes
   source eligibility; M06 revalidates its pack; M07 supplies the original budget.
   If no retrieval round/time remains, the answer exposes the update-related gap.
2. A document update commits but the process stops before the SDK saves its tool
   result. M08 can identify the committed operation. M07 reloads history and
   queries that outcome instead of issuing another update.
3. Two projects have a gateway with the same display name. M03 retains separate
   identities; M04 cannot invent a shared edge, and M05 cannot collapse the two
   project topics merely because their titles resemble each other.
4. A Wiki split publishes while a user requests an older edit-set restoration.
   M05 checks current page revisions, preserves later unrelated edits, and asks
   only if the recovery intent is materially ambiguous.
5. A browser disconnects during a source import. M09 reconnects to the same run;
   M07 continues consuming events, and M08 owns the accepted import outcome.

## Executable questions assigned to work items

| Question | Required evidence | Work item |
| --- | --- | --- |
| Can the pinned Forge snapshot be consumed independently with its patches? | Clean consuming-workspace install and browser/custom-tool scripted-provider run | 01 |
| Can every model request be budgeted before dispatch, including retries/summaries? | Counted request-admission and finalization cases; isolated local patch if needed | 01, 12 |
| Does PostgreSQL persistence preserve Forge entry/leaf and one-writer semantics? | Reopen, concurrent writer and uncertain-write cases | 02 |
| Does the selected Bun tokenizer/vector configuration handle the actual language mix? | Source-query fixtures and development retrieval comparison | 05, 16 |
| Are source activation and stale-candidate filtering correct under races? | Concurrent updates and source changes during answering | 06, 15 |
| Are graph limits and qualifiers adequate for useful multi-hop evidence? | Qualified/path coverage examples plus capped neighborhoods | 11, 12 |
| Do quality and timing targets hold for the agreed corpus/load? | Frozen reviewed data, real providers, failure-inclusive latency and cost reports | 17 |

These require executable evidence during the assigned work, not another round
of speculative user questions. Exact provider choice, actual corpus access and
paid-run resources are preparation inputs for that work. No speculative result
is recorded as passed.

## Refinement order

First review C02-C05 and M02/M06/M07 together, then M03 identity and M05/M04
publication, then the user-facing paths. Defer tuning numeric defaults until
development evidence exists. The evaluation plan remains delegated and can be
revised later without reopening settled product scope.
