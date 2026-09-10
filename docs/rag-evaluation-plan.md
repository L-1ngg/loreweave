# First-Version RAG Evaluation Plan

Status: provisional defaults selected by the assistant on 2026-09-10 under the
user's delegation in Q27 of the [design discussion](rag-optimization-design.md).
The user intends to refine evaluation later. No dataset has been assembled and
no evaluation has run. These defaults do not authorize implementation or fix
runtime architecture, model providers, or spending limits. Subsequent routine
runtime defaults are summarized by the [construction blueprint](rag-v1-blueprint.md),
with callable behavior owned by the [shared contracts](design/rag-v1/contracts.md).

## Dataset and scoring

Prepare 50 development questions (40 ordinary, 10 complex) and a separate frozen
acceptance set of 200 questions (160 ordinary, 40 complex). Tune only on the
development set. Review acceptance questions and reference evidence before
freezing them; do not use acceptance answers to tune prompts, retrieval, Wiki
content, or graph extraction. Deduplicate paraphrases across the two sets.
Indexing the shared source corpus is expected; injecting benchmark answers into
derived content is not.

Use the following acceptance-set distribution. Each question has one primary
evidence-condition category and may carry additional diagnostic tags.

| Source evidence condition | Ordinary | Complex |
| --- | ---: | ---: |
| Sufficient evidence for the requested answer | 120 | 24 |
| Missing some or all required evidence | 24 | 8 |
| Unresolved conflicting evidence | 16 | 8 |
| Total | 160 | 40 |

Include project-specific and cross-project questions, same-name entities,
version and applicability distinctions, paraphrases, textual tables, and code
where represented in the selected Markdown corpus. Do not require image-pixel
understanding or corpus-wide Global Search. Reference records identify the
source snapshot, project scope, required answer points, supporting passages,
and expected gaps or conflicts. Accept equivalent valid evidence, not just one
preselected chunk ID.

Apply the Q26 rubric: a question passes only when correctness/completeness,
source-grounded citations, and treatment of gaps/conflicts all pass. Incomplete
answers caused by missed available evidence fail completeness even when they
are safe to return to a user. Correctly identifying genuinely absent evidence
can pass. Errors and missing responses fail; report them rather than excluding
them from the denominator.

Provisional acceptance thresholds are at least 90% ordinary-question passes
(144/160) and 80% complex-question passes (32/40). These are engineering targets,
not evidence that those rates have been achieved or statistical guarantees.
Report counts and uncertainty alongside percentages; the complex and evidence-
condition slices are small. Report answerable-case completion, appropriate
abstention, and conflict handling separately to expose excessive refusal.

For the initial acceptance run, use human review of every answer against source
evidence as the final judgment. Automated citation checks and LLM-assisted
grading may assist; they do not replace this judgment. Save disagreements and
their resolution. Human evaluation here does not introduce a Wiki publication
approval step.

## Controlled comparisons

Compare four configurations on the same source snapshot and questions:

1. Original-source hybrid retrieval baseline.
2. The same baseline with Wiki retrieval available.
3. The same baseline with graph retrieval available.
4. The same baseline with both Wiki and graph retrieval available.

Hold the answering model, source parsing, base retrieval/reranking settings,
context limits, and common Agent budgets fixed where applicable. Select base
settings on development questions and freeze them before acceptance. Record
additional calls, tokens, and maintenance work introduced by each addition.
These configurations are experimental controls, not approved production routes.
Global Search remains excluded under Q10.

Report paired per-question changes, especially ordinary-query regressions and
complex-query gains. If a component adds no useful QA, browsing, or maintenance
benefit, bring that evidence back to architecture review. Do not automatically
remove the user-confirmed Wiki product based solely on QA scores. Any follow-up
tuning uses development data; revise and version the holdout if it becomes
contaminated.

## Latency and cost measurement

Use the Q23 capacity baseline and five concurrent submitted-but-unfinished
requests under Q24. Measure submission through complete answer and citation
delivery, including queueing, generation, and normal retries. Preserve Q21's
ordinary-query target (at least 95% within 15 seconds) and Q22's 60-second total
budget for complex queries. Count failures and timeouts as not meeting latency
targets, and report every complex-query deadline breach.

For the initial capacity run, keep five client request slots occupied until
1,000 requests finish, using a seeded shuffled schedule with 800 ordinary and
200 complex requests. Repeated questions are acceptable for load measurement;
they are not independent new quality samples. Disable answer-result caching for
the baseline run, report index/cache warm-up conditions, and record model,
provider quotas, hardware, answer lengths, errors, and retries. Report per-class
p50/p95 latency and success-within-target fractions. This load procedure does
not establish overload behavior above five requests.

Measure the primary latency baseline with ingestion and maintenance idle. Run
a separate interference check with one Markdown update and its derived-content
maintenance active during the same load, reporting the same targets and any
degradation separately. Do not claim that an idle-only pass establishes mixed-
workload performance. This test setup does not select production worker counts
or scheduling policy.

Record model/tool calls, tokens, and monetary cost where rates are known for
queries, initial construction, and updates separately. Measure source-searchable
and Wiki/graph-refresh times independently. No monetary limit or ingestion-time
product promise is set by this plan; runtime execution budgets are specified
separately in the blueprint and monetary limits depend on provider selection.

## Wiki and maintenance checks

Review 20 representative Wiki pages spanning shared organizational and project
knowledge. Apply correctness, source support, qualifiers, and visible-conflict
checks, with an initial target of at least 18 fully passing pages. Report broken
source/internal links separately and require all checked links to resolve.
Record whether a reader can locate the relevant topic and follow its evidence;
defer a formal usability study until an interface exists.

Prepare 12 lifecycle scenarios: three source-version updates, three conflicting-
source additions, three cross-project same-name cases, and three Wiki version-
restoration cases. Exercise only behavior already confirmed in the design;
use Q33-Q34 and the blueprint's publication/recovery rules when preparing fixtures.
All specified scenario assertions must pass before claiming lifecycle support.
Check that effective source changes prevent stale derived claims from supporting
current answers and that citations retain the correct source version. Do not
silently treat newly uploaded conflicting material as a replacement.

These are selected-case checks, not proof of zero errors over the whole corpus.
Exact corpus contents, page selections, questions, fixtures, reviewer assignment,
and executable tooling are later evaluation preparation work under this plan.

## Artifacts

Topic maintenance additionally records candidate recall@8/@16, false creation,
missed reuse, deferred-decision reasons, dependency/discovery coverage and model
work under [M05's policy](design/rag-v1/policies/wiki-topic-maintenance.md).
Use versioned human-reviewed development topic/source examples before tuning
its numeric defaults. Acceptance covers unseen routing examples and keeps
scripted control-flow verification separate from actual model routing quality.
These diagnostics add no unmeasured pass-rate claim or refresh-time SLA.

Persist the corpus/version manifest, development and acceptance dataset versions,
configuration and model identifiers, raw retrieved evidence, answers/citations,
grading decisions, timing/error records, cost records, and a comparison report.
Separate measured results from design targets and report limitations explicitly.

## Design closure cases and integration ownership

Online support review is part of the product under
[V01–V04](design/rag-v1/policies/evidence-validation.md); it does not replace the
independent human-reviewed acceptance labels. Capture generation/review request
counts, retries, rejection reasons, unsupported-claim misses and falsely rejected
supported claims separately. Normal finalization uses two model requests; caps
are three exploration plus two generation plus two review. Measure its added
latency under unchanged 15-second ordinary p95 and 30/60-second hard limits.

In addition to the existing lifecycle cases, require:

- Real but irrelevant citations, reversed/qualified claims, unlisted assertions,
  incorrect graph-path inference and support-review failure with no unsafe publish.
- Source change during final generation/review, one bounded refresh, exhausted
  slots, second change and abort settlement without budget reset.
- Identity proof source A changes while relationship sources B/C stay current;
  immediate invalidation of joined facts and later evidenced reconciliation.
- Wiki loses all current support and retires; unresolved checks cannot retire it;
  later support reactivates the same ID and historical restore remains non-evidence.
- Large pages and source proposals finish finite continuations or expose remaining
  ranges; worker restart and duplicate requests cannot reset root budgets.
- Graph packet overflow, unresolved identities, table/section context, zero-edge
  replacement, failed partial generation and independent alternate support.

[#17](https://github.com/L-1ngg/loreweave/issues/17) provides early source-answer
fixtures, versioned diagnostic schemas and adapters; unavailable maintenance
routes remain explicitly unavailable. [#20](https://github.com/L-1ngg/loreweave/issues/20)
integrates actual Wiki and graph diagnostics after #10, #12 and #17. Capture
routing recall/false creation/missed reuse, inspection coverage/termination,
retirement/reactivation, proof invalidation, graph generation coverage, review
outcomes and provider work with numerator/denominator and policy/model versions.
[#18](https://github.com/L-1ngg/loreweave/issues/18) performs the complete human and
real-provider acceptance comparison after that integration. Development fixtures
must not contaminate frozen acceptance inputs or be reported as measured quality.
