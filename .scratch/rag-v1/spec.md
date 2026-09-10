# LoreWeave construction specification

> Archived migration snapshot, 2026-09-10. The [GitHub issue](https://github.com/L-1ngg/loreweave/issues/1)
> owns the current scope, acceptance criteria, status and execution evidence.
> Read and update that issue before implementation; this snapshot is historical.

Product name: **LoreWeave**. Repository slug: **`loreweave`**.
The confirmed naming decision is recorded in
[Q40](../../docs/rag-optimization-design.md#q40-product-and-repository-name).

**Status at migration:** ready-for-agent

This is a reviewable construction baseline synthesized on 2026-09-10 under the
user's planning and routine-design delegation. Readiness describes specification
quality, not implementation authorization or completed behavior. Earlier user
confirmations remain authoritative; assistant-selected defaults are identified
in the design discussion, blueprint and evaluation plan.

## Problem Statement

Members need to understand enterprise/project documents, find supported answers,
and keep organized knowledge current as material changes. Ordinary retrieval
alone does not provide a maintained readable Wiki or explicit cross-document
relationships. Adding generated pages and a graph can amplify stale claims,
identity mistakes and unsupported conclusions unless provenance and lifecycle
rules are shared. The existing system's compatibility and reuse are not constraints
on this redesign.

## Solution

Provide one organization's Markdown knowledge system with a natural-language
conversation, versioned original evidence, automatically maintained topic Wiki,
and source-supported graph retrieval. Members import/update sources, browse
topics, ask questions, contribute corrections and restore unwanted Wiki edits.
External Agents retrieve cited evidence through the same domain behavior.

Use originals as factual support, Wiki as readable knowledge organization, and
graph relationships to discover related evidence. Preserve uncertainty, conflicts,
scope and source history throughout. Reuse Forge Agent's SDK for execution while
My-RAG controls product policy and knowledge effects.

### Required acceptance outcomes

| ID | Required observable outcome |
| --- | --- |
| AC01 | A host-controlled Forge turn calls only registered knowledge tools, respects admission budgets and exposes a durable product outcome separate from execution settlement. |
| AC02 | Authenticated organizational access and project/shared scope apply consistently to browser, tools and external clients. |
| AC03 | Markdown imports preserve source text/structure and yield stable versioned passage citations; retrying an accepted import does not duplicate it. |
| AC04 | A prepared source revision activates atomically; current evidence changes while old citations remain readable and stale derived support is excluded. |
| AC05 | Fact/rule questions retrieve original and available Wiki evidence, produce supported complete answers or explicit gaps, and retain meaningful qualifiers. |
| AC06 | Same-name entities remain distinct without sufficient identity evidence; identity corrections preserve mentions and invalidate dependent knowledge. |
| AC07 | Graph retrieval follows bounded qualified source-supported relationships, reports incomplete coverage and never equates a missing edge with a negative fact. |
| AC08 | Cross-document topic Wiki pages auto-publish after checks, cite originals and expose conflicts and failed refreshes accurately. |
| AC09 | Source/correction changes update affected knowledge; pending Wiki/graph content cannot override current original evidence. |
| AC10 | Page creation/merge/split/restoration preserve recoverable edit history, old entry points and version-specific citations. |
| AC11 | Natural-language source/update/correction requests use context, execute when clear and clarify ambiguous targets without requiring internal IDs. |
| AC12 | Conversation restart, cancellation and reconnect preserve known effects and never blindly replay a tool call with an uncertain outcome. |
| AC13 | Timing/call/round limits include queueing and retries, preserve finalization time and count failed/partial requests accurately. |
| AC14 | External Agents receive scope-correct evidence and cited answers without needing the browser conversation state. |
| AC15 | Durable maintenance handles duplicate requests, worker replacement and obsolete jobs without duplicate effects or stale publication. |
| AC16 | Reproducible evaluation compares source-only, Wiki, graph and combined routes, with separate quality/latency/cost and lifecycle evidence. |

## User Stories

1. As a member, I want to import Markdown so organizational knowledge becomes searchable.
2. As a member, I want headings, lists, tables and code preserved so the source keeps its meaning.
3. As a reader, I want exact original passages behind citations so I can inspect the evidence.
4. As a contributor, I want revised files associated with the right document so history remains traceable.
5. As a contributor, I want natural-language update instructions so I need not know internal IDs.
6. As a contributor, I want clarification when the target is ambiguous so the wrong project is not updated.
7. As a member, I want visible import and maintenance states so I know which knowledge is ready.
8. As a reader, I want project and shared-topic navigation so I can find relevant knowledge.
9. As a reader, I want one topic to integrate several sources so I can understand scattered information.
10. As a reader, I want shared organizational guidance linked from projects so repeated copies do not diverge.
11. As a contributor, I want new sources to refresh related topics so I need not edit Wiki bodies manually.
12. As a contributor, I want corrections and organization preferences retained so later maintenance respects them.
13. As a reader, I want unresolved disagreements shown with sources so I can judge uncertainty.
14. As a reader, I want time, environment and planned/current distinctions preserved so advice fits my situation.
15. As a member, I want fact and rule answers with necessary conditions so I can act on them.
16. As a member, I want cross-entity questions answered from linked original evidence so scattered relationships are discoverable.
17. As a member, I want evidence gaps stated explicitly so absence of retrieval is not disguised as certainty.
18. As a member, I want same-name people/services distinguished so answers do not mix projects.
19. As a contributor, I want mistaken entity identities corrected so their downstream effects can be repaired.
20. As a reader, I want current originals used while derived knowledge refreshes so updates take effect promptly.
21. As a reader, I want historical versions to remain accessible so I can understand earlier answers and changes.
22. As a contributor, I want unwanted page restructuring recoverable so automatic maintenance remains correctable.
23. As a contributor, I want restoration to honor current evidence so old rules do not silently become current again.
24. As a member, I want conversation context across turns so follow-up requests refer to the intended project/document.
25. As a member, I want cancellation and reconnection without duplicate changes so network interruption is manageable.
26. As an administrator, I want organization membership and credential revocation so access has a clear owner.
27. As an external Agent user, I want cited evidence and answers through MCP so I can use the knowledge in other workflows.
28. As an operator, I want bounded model work and durable job status so failures and costs can be diagnosed.
29. As an operator, I want retries and restart recovery to preserve operation identity so work is neither lost nor blindly repeated.
30. As a maintainer, I want separate measurements for retrieval, Wiki and graph so I can justify their complexity.

## Implementation Decisions

- Use a TypeScript/Bun backend, Hono, React/Vite and PostgreSQL with pgvector.
  Framework/package versions are pinned during implementation preparation.
- Embed the Forge public SDK from the inspected fixed source revision. Preserve
  required workspace dependencies, upstream licenses and patches. Configure
  supported policies, implement knowledge policy in the host, and isolate any
  required request-admission patch with regression coverage.
- Use nine modules: Access/scope, Sources, Entity identity, Graph, Wiki, Evidence
  and answers, Agent Host, Durable operations, and Product interfaces. These are
  testable responsibilities, not nine deployable services.
- Separate entities from graph claims so Wiki and graph share identities while
  deriving independently from original material.
- Preserve immutable original and Wiki versions with stable IDs, references,
  dependency manifests and trusted organizational/project scope.
- Prepare source parsing/search data before activation. Validate source and
  identity dependencies at publication, retrieval and final answer admission.
- Use durable operation keys and transactional outcomes independently of SDK
  history, with worker/session fencing and explicit uncertain outcomes.
- Use source/Wiki hybrid retrieval for ordinary questions and immediate graph
  retrieval for clear relationship questions. Follow-up retrieval remains bounded.
- Route final answer generation through the Evidence module with tools disabled
  and the same shared budget. Citation handles must resolve to actual original
  evidence. No summaries become independent evidence.
- Automatically maintain topic boundaries, check candidate publication, and
  restore past page content through new versions against current source state.
- Distinguish run outcome from execution settlement and from durable operation
  outcome; canceled responses do not roll back accepted changes.
- Keep one logical organizational knowledge base with shared/project scope,
  basic membership and operation grants, and no project-specific reading ACLs.
- Build a fresh schema and contracts. Compatibility, migration and reuse of the
  old Python system are not acceptance requirements.

## Testing Decisions

Test observable behavior through module commands/queries and product interfaces.
Use actual PostgreSQL transactions for activation, fencing and persistence cases;
scripted local model providers for deterministic tool/evidence/timeout cases;
browser and MCP paths for final interaction parity. Use meaningful parser and
qualifier examples without asserting private call order or exact generated prose.

User-confirmed requirements own source traceability, scope, conflict/identity
handling, source freshness, bounded follow-up and restoration behavior. Q26
defines per-question correctness/completeness, actual citation support and gap/
conflict handling. Q27 delegates evaluation details, and Q36 delegates routine
test-seam and implementation defaults; no new routine testing confirmation is
needed. Numerical defaults are targets, not observed current performance.

Capacity baseline: 1,000 active Markdown documents and at most 20 million original
characters, with five concurrent requests. Workload: 80% ordinary and 20% complex.
At least 95% of ordinary requests complete within 15 seconds, with a separate
30-second hard cutoff; complex requests have a 60-second total budget. Include
queueing, generation, retries and errors in reporting. The detailed measurement
method and provisional quality thresholds remain owned by the evaluation plan.

Prior evidence includes 43 passing Forge SDK/tool/persistence/cancellation/retry
tests at the inspected revision, verified earlier in this conversation. These
are not My-RAG integration evidence. Existing Python retrieval/evaluation tests
can provide behavior examples but do not certify the new Bun implementation.

Before a release claim, validate malformed citations, source updates during
generation, pending/failed maintenance, shared evidence deduplication, qualified
multi-hop answers, uncertain effects after restart, and timeout settlement.
Keep the development set separate from the frozen reviewed acceptance set.

## Out of Scope

- PDF/DOCX/TXT ingestion, OCR, image understanding and binary attachment ingestion.
- Automated external document synchronization and corpus-wide Global Search.
- Fine-grained project visibility, multiple organizations as a first-version
  product, SSO and a general-purpose coding or multi-agent platform.
- Direct human editing of Wiki bodies, automatic persistence of unsupported
  query inferences as factual graph claims, and name-only entity merging.
- Old-system compatibility, automatic data migration or destructive cutover.
- Production deployment or paid provider execution as a consequence of this spec.

## Further Notes

The implementation tracker is local Markdown. The user requested a construction
blueprint, smaller modules and alignment; work-item readiness does not mean that
implementation has been requested. Routine choices are settled in this baseline;
SDK request-admission, Chinese retrieval quality and lifecycle atomicity need
executable validation in their assigned slices.

- [Module map and owned interfaces](../../docs/design/rag-v1/README.md)
- [Shared contracts](../../docs/design/rag-v1/contracts.md)
- [Alignment record](../../docs/design/rag-v1/alignment.md)
- [Work-item map](README.md)
- [Evaluation plan](../../docs/rag-evaluation-plan.md)
- [User decisions and delegations](../../docs/rag-optimization-design.md)
- [Forge SDK decision](../../docs/adr/0003-forge-agent-sdk-and-bun-host.md)
