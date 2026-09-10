# RAG Optimization Design Discussion

Status: design recorded, implementation not started. User-confirmed decisions
and explicitly delegated defaults are distinguished below. Q36 delegates routine
design and Q37 permits component selection without compatibility constraints.

This document owns the optimization goals and interview record. Where a decision
links to an ADR, that ADR owns its architectural rationale and constraints.
Domain terms live in [CONTEXT.md](../CONTEXT.md). The current implementation
remains described by [architecture.md](architecture.md) and
[contracts.md](contracts.md). The [first-version blueprint](rag-v1-blueprint.md)
owns assistant-selected design defaults under Q36-Q39. Q39's construction spec
and module contracts consolidate the callable behavior. Earlier statements that
details remain undecided describe the interview at that point; the blueprint
settles routine details unless it explicitly leaves them for later preparation.

## Confirmed decisions

### Q1: Primary task

Confirmed by the user on 2026-09-09.

The primary task is traceable question answering and evidence retrieval over
imported documents, serving users and external Agents.

For example, when asked how a failed task is retried, the system should return
supporting original passages, source locations, and necessary context. It should
identify evidence gaps when the documents do not support an answer.

This makes necessary-evidence coverage, answer support, and citation accuracy
the priorities for defining quality goals. Their metrics and acceptance targets
are specified by Q26 and the provisional evaluation plan delegated in Q27.

### Q2: Dominant question type

Confirmed by the user on 2026-09-09.

The first version prioritizes specific fact and rule queries whose answers can
usually be supported by a small number of explicit source passages. Examples
include retry limits, role permissions, and conditions for indexing a document.

These queries are the main focus of the evaluation set. Q25 sets the initial
ordinary-to-complex question mix, Q9 establishes relationship retrieval, and Q10
defers corpus-wide Global Search.

### Exploration scope clarification

Requested by the user on 2026-09-09.

Explore a thorough redesign of the system, including whether integrating LLM
Wiki and GraphRAG would make a useful project. The investigation includes a
potential new product shape, beyond incremental retrieval tuning.

Q1 and Q2 remain confirmed workload preferences. Q3 below confirms the Wiki as
an additional product outcome, and Q8 settles shared source and entity identity
for Wiki and graph representations. Q9 establishes entity-centered retrieval as
the graph's primary role. Q10 defers corpus-wide Global Search. Library choices
and the remaining implementation architecture are undecided.

The [Wiki and GraphRAG feasibility study](research/llm-wiki-graphrag-feasibility.md)
records primary-source findings, candidate designs, and proposed experiments.
Its recommendations are proposals, not confirmed decisions.

### Q3: Wiki as a product deliverable

Confirmed by the user on 2026-09-10.

A maintained Wiki is a formal product deliverable: users can directly read and
browse its pages and trace their content to source material. The product
therefore includes a readable knowledge base alongside question answering and
evidence retrieval.

Wiki usefulness must be assessed through reading, navigation, and source
traceability as well as question-answering quality. Editing ownership is settled
in Q4 and the publication default in Q5 below. User interface and storage format
remain undecided.

### Q4: Wiki editing ownership

Confirmed by the user on 2026-09-10.

In the first version, the LLM owns Wiki body edits. Users contribute source
material, correction requests, and instructions about how knowledge should be
organized, rather than directly editing page bodies.

For example, a user supplies evidence that a retry limit changed from three to
five and requests a correction. The LLM uses that input to update the relevant
pages, preserve source references, and check other affected content. Correction
inputs must remain available to subsequent maintenance and regeneration.

This makes the editing process more indirect for users while giving automated
maintenance a consistent set of inputs. Q5 below settles the publication default.

### Q5: Automatic Wiki publication

Confirmed by the user on 2026-09-10.

Completed LLM updates are published automatically by default, making the updated
Wiki available for direct reading and subsequent question answering without
requiring routine manual approval of each update.

Retain viewable, restorable version history so users can inspect changes and
return to an earlier version. Users may submit corrections after publication.
This reduces review overhead while allowing generated content to be used before
an exhaustive human review; errors may therefore require post-publication
correction.

Q6 settles unresolved source conflicts, Q34 specifies Wiki version restoration,
and Q35 establishes automatic publication checks. The blueprint under Q36-Q37
specifies publication and synchronization defaults.

### Q6: Unresolved source conflicts

Confirmed by the user on 2026-09-10.

When sources appear to disagree, first examine their time, version, and scope
of applicability. Statements applying to different circumstances need not be
treated as conflicting rules for the same circumstances.

If these distinctions do not resolve the disagreement, retain both statements
and their source references. Wiki pages and answers addressing the disputed
point must explicitly show the unresolved conflict instead of choosing an
unsupported single conclusion.

For example, if two sources specify retry limits of three and five for the same
service and conditions, with no clear replacement or applicability information,
the answer should present both limits with their respective citations and state
that the applicable rule cannot yet be determined.

Such pages may still be published automatically with the conflict made visible.
The trade-off is that some questions yield a sourced disagreement rather than a
single definitive answer.

### Q7: Queries while Wiki updates are pending

Confirmed by the user on 2026-09-10.

When a source change is effective and its relevant original material is already
searchable, but affected Wiki content has not yet been refreshed, keep the old
page browsable and visibly mark it as pending update.

Questions involving that stale content must temporarily bypass the affected
Wiki content and use applicable original evidence. Unaffected content can
continue to serve queries. Once the Wiki update completes, publish it
automatically under Q5 and restore its normal use for questions.

For example, when a new manual explicitly replaces the old retry rule, answers
can cite the new manual while the Wiki still shows the old rule with a pending
update label. This permits a temporary difference between a current answer and
the visibly outdated page. A newly uploaded source alone does not establish
that an older rule has been superseded; unresolved applicability follows Q6.

### Q8: Shared identity and source-grounded derivation

Confirmed by the user on 2026-09-10.

Wiki and graph representations share source and entity identity and are derived
separately from original material. The architectural decision and trade-off are
recorded in [ADR-0001](adr/0001-shared-wiki-graph-provenance.md).

### Q9: Primary graph query role

Confirmed by the user on 2026-09-10.

The graph's primary role in the first version is entity-centered retrieval of
related source material, including multi-hop questions. Identify relevant
entities, follow useful relationships, and retrieve the associated original
passages to produce cited answers.

For example, a question about the projects a person manages and the databases
those projects use requires connecting person, project, and database evidence
across documents. This is a Local Search-style retrieval responsibility, not a
commitment to Microsoft's implementation.

The intended benefit is better cross-document evidence coverage. Entity
disambiguation and irrelevant relationship expansion require evaluation. Q28
settles the query-role split, and Q21-Q24 establish latency and capacity targets.
Graph expansion limits and routing implementation remain undecided. Q10 settles
the first-version scope of corpus-wide Global Search.

### Q10: Defer corpus-wide Global Search

Confirmed by the user on 2026-09-10.

Corpus-wide synthesis through Global Search is deferred to a later version.
The first version focuses on maintained Wiki content, source-grounded question
answering, and entity-centered retrieval of related evidence.

The deferred capability covers questions requiring broad coverage of the entire
corpus, such as common technical trends across all projects. It introduces
additional summary maintenance and cross-community synthesis costs that are not
part of the first version's required product outcomes.

Topic-specific Wiki organization and synthesis remain in scope. The first
version does not promise complete corpus-wide analytical coverage. This scope
decision does not select a graph library or determine its internal data needs.

### Q11: Initial corpus domain

Specified by the user on 2026-09-10.

The intended initial corpus is enterprise- and project-related knowledge
documents. This provides the domain for selecting representative source material
and evaluating Wiki organization, cited answers, and entity relationships.

Specific document categories, source systems, languages, and update frequency
remain to be established. Q12 settles the initial user and organizational scope,
Q15-Q17 settle ingestion and source-format scope, and Q23 sets the initial
corpus capacity baseline.

### Q12: One organization with multiple projects

Confirmed by the user on 2026-09-10.

The first version serves one enterprise or team internally and covers multiple
projects. It supports organizational knowledge and project-related material,
with members reading Wiki content, asking questions, and contributing corrections
through the input model established in Q4.

This provides a concrete setting for evaluating shared knowledge, project
context, and cross-project relationships. Q13 below settles logical knowledge
organization, and Q14 settles first-version project-level visibility. Basic
access, contribution permissions, and deployment remain undecided. Q23 sets the
corpus capacity baseline, and Q24 sets the question-answering concurrency baseline.

### Q13: One organizational knowledge base with project classification

Confirmed by the user on 2026-09-10.

Use one logical knowledge base for the organization. Classify material by its
organization-wide or project-specific affiliation, preserving that affiliation
through knowledge organization and retrieval.

Projects can reference common organizational knowledge, and shared people or
components can be linked across projects. Questions can target a project scope
or retrieve related evidence across projects. Q14 below settles whether project
membership restricts knowledge visibility in the first version.

Identically named objects in different projects must remain distinguishable;
matching names alone do not establish shared entity identity. This decision
selects a logical organization model, not a physical index layout, exclusive
single-project ownership for every source, or a member visibility policy.

### Q14: Defer fine-grained project visibility controls

Specified by the user on 2026-09-10.

The first version does not implement fine-grained restrictions that hide project
material from particular organizational members. Project classification is used
for content organization and retrieval scope, not as a member-specific reading
permission boundary.

This scope applies consistently to original material, Wiki content, and graph
retrieval. Organization access, authentication, and permissions to import,
correct, or administer material remain separate decisions; this does not
authorize public access or changes to the current service's authentication.

### Q15: User-initiated file ingestion

Confirmed by the user on 2026-09-10.

The first version receives source material through user-initiated file upload or
import and supports updates to existing material. Preserve source versions so
newly provided material can drive Wiki and graph maintenance while retaining
traceable evidence.

For example, a user imports a project manual and later provides its revised
version. The system processes that update through the knowledge maintenance
workflow. Users are responsible for providing source updates; automatic
synchronization from external document systems is deferred.

Q16 below settles the source file format, Q18 establishes natural-language
ingestion and update intent, and Q19 confirms a built-in conversational entry
point. Interface technology and layout remain undecided.

### Q16: Markdown-only source ingestion

Confirmed by the user on 2026-09-10.

The first version accepts Markdown source documents only. Preserve the original
files and document structure, with source-version and passage references for
derived Wiki content, graph relationships, and retrieval evidence.

Use direct Markdown structure parsing and limited normalization that preserves
meaningful content. PDF, Word, and OCR conversion are outside the first-version
system; users convert other source formats before importing them.

This concentrates implementation and evaluation on knowledge maintenance and
retrieval rather than document-format recovery. It places conversion work and
input preparation on users. Q17 below settles image-content scope. Exact
Markdown syntax support and parsing acceptance criteria remain undecided.

This is a redesign target, not a description of current support: the existing
ingestion path uses MinerU and does not yet accept direct Markdown imports.

### Q17: Text-based Markdown understanding

Confirmed by the user on 2026-09-10.

The first version derives knowledge from Markdown text, including prose, lists,
textual tables, and code blocks. Preserve image references and any supplied
alternative text or surrounding descriptions, but do not interpret image pixels
or extract text and relationships from images.

For example, a service dependency explicitly described in the source text can
support graph extraction. A dependency shown only in an architecture image
cannot support extraction in this version. Users must provide a textual
description if that information should participate in knowledge processing.

This scope does not select a Markdown dialect or determine attachment upload,
image fetching, or display behavior.

### Q18: Natural-language ingestion and update requests

Confirmed by the user on 2026-09-10.

Users express whether material is new or updates an existing document through
natural language. Resolve the target using the request, current project,
selected document, supplied file, and available conversation context. When the
intended operation and target are clear, execute without a routine additional
confirmation; ask a concise clarification when they are ambiguous.

For example, a user viewing a document can request that a supplied file update
it. If a request to update a requirements document could refer to two projects,
ask which project before performing the update. An explicit new-document request
creates a new document instead of replacing an existing one.

The LLM interprets intent and identifies the document; document operations own
stable identity, version creation, source preservation, and downstream update
triggers. Users need not provide internal document IDs or manually select a
document when natural language and context already identify it. Q19 below
settles where the conversational capability is hosted.

### Q19: Built-in conversational entry point

Confirmed by the user on 2026-09-10.

The first version includes its own conversational entry point for source import,
updates, and question answering, alongside Wiki browsing. The architectural
rationale and expansion from the current external-Agent model are recorded in
[ADR-0002](adr/0002-built-in-knowledge-conversation.md).

### Q20: Bounded follow-up retrieval

Confirmed by the user on 2026-09-10.

When initial evidence is insufficient, the conversational Agent may initiate
additional retrieval directed at the missing information. Answer when the
evidence is sufficient; stop when a retrieval-count, elapsed-time, or cost
budget is reached and state any remaining evidence gaps.

For example, an initial search may identify all projects managed by a person
but omit one project's database. The Agent may retrieve evidence specifically
for that project before composing its answer.

This permits adapting subsequent retrieval to earlier results, beyond the graph
relationship traversal established by Q9. It can improve evidence coverage at
the expense of additional latency and model or tool calls. Q22 settles the total
time budget for complex relationship questions. Retrieval-count and cost limits,
the hard cutoff for ordinary questions, and stopping implementation remain
undecided.

### Q21: Ordinary question-answering latency target

Confirmed by the user on 2026-09-10.

For ordinary fact and rule questions, at least 95% of submitted requests should
return the complete answer and its citations within 15 seconds in the first
version. Measure from user submission through complete response delivery,
including retrieval, generation, and normal retries. Failed and timed-out
requests count as not meeting the target.

Examples include identifying a project's owner or finding a documented retry
limit. Complex relationship questions, source ingestion, and Wiki refresh have
separate timing decisions. The target is not a 15-second hard cutoff for every
ordinary request, and does not establish answer correctness by itself.

This is an acceptance target to guide model and query-path decisions, not
verified current performance. Q23 sets the corpus capacity baseline, and Q24
sets concurrency. Q25 sets the initial question-type mix. The representative
test set must still be prepared; Q27 delegates the detailed evaluation defaults.

### Q22: Complex relationship question time budget

Confirmed by the user on 2026-09-10.

Complex relationship questions that require follow-up retrieval have a total
budget of 60 seconds per request, from submission through complete answer and
citation delivery. This includes initial retrieval, subsequent retrieval, and
final answer generation. Reserve time for composing and delivering the answer
rather than spending the whole budget on evidence collection.

Stop early when sufficient evidence is available. As the budget approaches,
stop further retrieval and answer from the evidence already obtained, explicitly
identifying any remaining gaps. A partial but supported answer is acceptable;
the time budget does not justify unsupported claims.

This is a first-version design constraint, not verified current performance.
Retrieval-count and cost limits, the answer-time reserve, and the mechanism for
enforcing the deadline remain undecided. Q23 and Q24 set the corpus capacity and
question-answering concurrency baselines for validation.

### Q23: Initial corpus capacity baseline

Confirmed by the user on 2026-09-10.

Design and validate the first version against a baseline of 1,000 active
Markdown documents, counting the currently effective version of each document,
with no more than 20 million characters of original Markdown text in total.
This text budget includes prose, tables, and code. Historical source versions
are accounted for separately in storage.

The corpus covers multiple projects and shared organizational documents so
validation can exercise cross-project retrieval and distinguish entities with
the same name in different projects.

This is an agreed capacity acceptance baseline, not an inventory of existing
material, a verified performance result, or an upload limit. Materially larger
corpora require expanded testing before making capacity and latency claims.
Document-length distribution, languages, update frequency, and historical-version
volume remain undecided. Q24 sets the question-answering concurrency baseline.

### Q24: Question-answering concurrency baseline

Confirmed by the user on 2026-09-10.

Use five concurrent question-answering requests as the first-version acceptance
baseline. Concurrency counts requests that have been submitted but have not yet
returned a complete answer, across both the built-in conversation and external
Agent clients. It does not count registered accounts or idle sessions.

At the Q23 corpus scale and this concurrency level, validate that at least 95%
of ordinary questions meet the Q21 15-second target and that complex relationship
questions respect the Q22 60-second total budget. Internal queueing time counts
toward response latency.

This is a validation target, not verified current capacity or a decision about
request admission above five concurrent requests. Q25 sets the initial
ordinary-to-complex query mix. The provisional evaluation plan under Q27 defines
the background-work conditions and load-test procedure.

### Q25: Initial evaluation question mix

Confirmed by the user on 2026-09-10.

Configure the initial acceptance workload as 80% ordinary fact and rule questions
and 20% complex relationship questions. For example, a 100-question workload
would contain 80 ordinary and 20 complex questions; this example does not fix
the evaluation set size.

Report quality and latency separately for the two categories so ordinary-query
results cannot conceal weaknesses in complex questions. Assign question types
before testing; a slow ordinary answer must not be reclassified as complex.
Include insufficient-evidence and conflicting-source cases within these
categories.

This is an initial evaluation configuration consistent with Q2, not a measured
production traffic distribution. Revisit it when actual usage data is available.
Q27 delegates the sample size and evidence-condition distribution to the
provisional evaluation plan. Specific questions remain to be prepared.

### Q26: Per-question quality acceptance rubric

Confirmed by the user on 2026-09-10.

A question passes only when all three requirements hold:

- The answer is correct and covers the required key facts, including necessary
  version, time, scope, and applicability conditions.
- Key factual claims have citations that resolve to the relevant source version
  and original passage, and those passages support the claims. Wiki and graph
  content must also remain traceable to original evidence.
- Missing evidence is explicitly identified, and unresolved conflicts retain
  the competing statements and their sources without unsupported arbitration.

Correctly identifying an actual source-evidence gap can pass. Missing information
that is available in the corpus, including omissions caused by retrieval failure
or exhausted time, fails completeness. Returning a supported partial answer is
permitted by Q22 but does not automatically count as completing the task.

### Q27: Delegated provisional evaluation decisions

Delegated by the user on 2026-09-10.

The user delegates remaining evaluation decisions to the assistant for now and
intends to refine evaluation later. Do not continue requesting individual
evaluation confirmations. Preserve Q21-Q26 and record assistant-selected defaults
as provisional rather than individually user-confirmed choices.

The [first-version evaluation plan](rag-evaluation-plan.md) owns those defaults:
50 development and 200 acceptance questions, per-category quality thresholds,
evidence-condition coverage, four controlled retrieval configurations, load and
cost measurement, and Wiki/maintenance checks. Dataset preparation and execution
have not occurred. This delegation covers evaluation planning, not implementation
or automatic approval of the remaining product and architecture decisions.

### Q28: Routine source and Wiki retrieval with graph use as needed

Confirmed by the user on 2026-09-10.

For ordinary fact and rule questions, retrieve original material and relevant
Wiki content. Use Wiki organization to locate topics and understand context,
and retrieve original passages to support key factual conclusions. Bypass stale
Wiki content as required by Q7.

For questions that clearly require cross-entity relationships, use the graph
in the initial retrieval round to locate relationships and their supporting
original passages. For example, connecting a person's projects to their service
dependencies should not have to wait for an ordinary retrieval attempt to fail.

When initial evidence is insufficient, the Agent chooses further source, Wiki,
or graph retrieval according to the missing information and within the agreed
budgets. Failure to extract or find a graph relationship does not establish
that the relationship does not exist.

This gives Wiki a knowledge-organization role, the graph a relationship-based
evidence-discovery role, and original material the role of factual support. It
avoids requiring graph expansion for every simple question, at the cost of
routing decisions that can miss a useful graph lookup; bounded follow-up
retrieval provides a recovery opportunity. Routing implementation, retrieval
scheduling and fusion, and graph expansion limits remain undecided.

### Q29: Topic-oriented Wiki pages across source documents

Confirmed by the user on 2026-09-10.

Organize the Wiki primarily as topic pages that can integrate knowledge from
multiple source documents, with browsing entry points for shared organizational
knowledge and individual projects. A page may use several sources, and one
source may support several pages. Preserve original evidence references for the
claims presented in each page.

For example, a project's requirements, deployment manual, and meeting records
may support separate project-overview, release-process, and service-dependency
pages. Project pages can link to shared organizational release guidance.

When material arrives, prefer updating relevant existing topic pages; create a
new page for a distinct new topic. This supports reusable knowledge organization
and direct reading, while requiring explicit topic boundaries to avoid duplicate
or excessively broad pages. Q30 settles the creation, merge, and split policy.

Graph entities such as people or services may link to relevant Wiki pages.
There is no requirement to generate a page for every graph entity. This decision
does not select a fixed folder hierarchy, physical storage format, or page schema.

### Q30: Automatic Wiki page creation, merging, and splitting

Confirmed by the user on 2026-09-10.

Allow the LLM to maintain topic boundaries through the following operations:

- Prefer updating an existing page when new material supplements or revises the
  same topic.
- Create a page when a distinct, independently readable topic cannot reasonably
  fit an existing page. Multiple source documents are not a prerequisite.
- Merge pages when they cover the same subject, topic, and applicability scope
  with substantial duplication. Similar titles alone do not justify merging.
- Split a page when it contains independently readable and maintainable topics
  whose combination impedes finding or updating knowledge. Length alone is not
  a sufficient trigger.

For example, overlapping release-process and deployment-step pages for project A
may be merged. Similar release-process pages for projects A and B retain their
distinct applicability scopes.

These operations follow Q5's automatic publication policy. Preserve change
history, maintain access through old page entry points and traceability of
references, and support recovery from mistaken restructuring. Users may also
request organization changes through natural language. Avoid repeated
restructuring without a substantive reading or maintenance benefit.

This reduces duplicate and overly broad pages at the cost of possible topic-
boundary errors and additional history and reference maintenance. Exact page
identity, old-entry navigation, and restructuring implementation remain
undecided. Q34 specifies page-content restoration; recovery across a multi-page
restructuring operation still requires implementation design.

### Q31: Evidence-based entity identity resolution

Confirmed by the user on 2026-09-10.

When entity identity is uncertain, keep separate records until sufficient
evidence supports unification. Explicit source statements identifying the same
object, or matching reliable unique identifiers within their applicable scope,
can support automatic identity resolution. Preserve the basis for that decision.

Matching names, similar descriptions, and embedding similarity identify
candidates but do not by themselves justify merging. Apply this principle both
across projects and within a project. For example, two projects' references to a
gateway remain distinct unless evidence establishes that they use the same
service, such as an explicit statement of a shared platform gateway with a
reliable identifier.

Uncertain identity associations may be retained for investigation, but must not
be treated as confirmed identity links in reasoning. Missing identity evidence
can leave duplicate representations and incomplete relationship retrieval;
follow-up source retrieval or natural-language user corrections can help resolve
them. Routine human review of every entity is not required.

This prioritizes avoiding erroneous unification and its propagation through
Wiki and graph content, at the cost of temporarily missing some true links.
Matching implementation, correction validation, and recovery from an incorrect
identity merge remain undecided.

### Q32: Source-supported graph relationship admission

Confirmed by the user on 2026-09-10.

The first-version graph admits relationships explicitly supported by original
material. The LLM may interpret context, resolve references, and normalize
expressions, but each relationship must retain supporting source references
and necessary applicability conditions, including time, environment, and
whether a statement describes a plan rather than current use.

For example, a source stating that project A uses MySQL in production supports
that qualified relationship. A planned migration to PostgreSQL must not become
a claim of current use. Mere co-occurrence of project A and Redis does not
establish a usage relationship. Source support records what the material says;
it does not independently verify its truth or eliminate conflicts under Q6.

Multi-hop answers may combine supported relationships while preserving their
meaning and citing the underlying passages. Knowing that a person manages a
project and that the project uses a database supports identifying that database
as used by the person's project; it does not establish that the person maintains
the database. Query-time inferences must explain their basis and are not
automatically persisted as factual graph edges in the first version.

This limits unsupported relationships propagating into answers at the cost of
a potentially sparser graph and more source-based reasoning during queries.
Relationship vocabulary, qualifier representation, and extraction validation
remain undecided.

### Q33: Retire unsupported old graph relationships during source updates

Confirmed by the user on 2026-09-10.

When a source update is effective and its original material is searchable,
immediately exclude old relationships that have lost applicable source support
from current graph retrieval. Refresh the affected graph asynchronously; queries
use effective original evidence while the relevant graph content is pending.

Retain relationships supported by other applicable sources, preserving those
references. If those sources conflict with new material, apply Q6 rather than
silently selecting a single conclusion. A newly uploaded source alone does not
establish replacement of an older rule; determine version and applicability.

For example, when an effective revised manual explicitly states that project A
has migrated from MySQL to PostgreSQL, an old relationship supported only by the
superseded manual must no longer guide current graph retrieval. Answers can use
the revised source before new relationships have been extracted.

Retain old relationships and their source references for historical traceability.
Unaffected relationships remain usable. When extraction completes, make updated
relationships available with their new source-version references. This aligns
with Q7's treatment of stale Wiki content and prioritizes current evidence over
temporary graph coverage, at the cost of additional source retrieval during
updates. Effective-version activation, invalidation, synchronization, and
in-flight query handling mechanisms remain undecided.

### Q34: Restore Wiki content as a new version against current sources

Confirmed by the user on 2026-09-10.

Restore a selected historical Wiki page's content as a new version, preserving
the full history and recording the restoration operation. Recheck the restored
content against currently applicable original evidence. Source material and
the graph continue under their respective effective versions; restoring a Wiki
page does not itself revert them.

When relevant source material has not changed and the restored content remains
supported, the page may serve reading and question answering normally. When
source changes have made some restored content stale, visibly mark it as pending
update, use applicable original evidence for related answers under Q7, and have
the LLM revise the content against current material.

For example, restoring a clearer release-process layout must not make an obsolete
two-approver rule current again after the applicable source changed the rule to
three approvers. Preserve a user-supplied restoration reason, such as retaining
the earlier step structure, as input to subsequent maintenance under Q4.

This supports recovery from unwanted Wiki edits while preserving evidence
freshness. Restored stale content may need further revision and cannot remain
unchanged as current knowledge merely because it was restored. Restoration
implementation and recovery across page merges or splits remain undecided.

### Q35: Automatic checks and bounded repair before Wiki publication

Confirmed by the user on 2026-09-10.

Check candidate Wiki updates automatically before publication: source references
and internal links must resolve; key claims must have supporting evidence and
retain necessary qualifiers; stale content and known unresolved conflicts must
be represented correctly. Model-assisted semantic review is permitted, but a
passing check is not proof of factual correctness.

Publish passing candidates automatically. On failure, attempt bounded repair;
if repair is exhausted, retain the failure reason and expose an update-failed or
pending-action state. Prior content remains subject to its actual validity:
effective portions remain usable and stale portions follow Q7's source fallback.
Explicitly represented source conflicts may pass and publish under Q6.

This adds maintenance latency and model work to intercept some unsupported
claims and broken references before publication. Q36 delegates repair counts
and implementation defaults to the blueprint.

### Q36: Delegated routine design decisions

Delegated by the user on 2026-09-10.

The user asks the assistant to decide subsequent simple design matters directly
instead of continuing individual confirmations. Record these as assistant-selected
defaults in the [first-version blueprint](rag-v1-blueprint.md), preserving the
confirmed product requirements and Q27's evaluation delegation. Resolve reversible
implementation details without reopening the routine interview.

Material product-scope changes, spending commitments, and destructive execution
still require concrete treatment in context. This delegation is for design and
does not itself request implementation or deployment.

### Q37: Component selection independent of the previous system

Specified by the user on 2026-09-10.

The assistant may retain or replace any existing component according to its
suitability for the new system. Compatibility and code/infrastructure reuse are
not design requirements. Do not prefer a component merely because the previous
system used it, and do not add migration or compatibility work as an assumed
product requirement.

The blueprint selects components for the confirmed first-version workload and
records alternatives and verification limits. This removes design constraints;
it does not authorize deleting existing data or changing a live system.

### Q38: Forge Agent reuse and upstream feedback

Specified by the user on 2026-09-10.

Use or reference [Forge Agent](https://github.com/L-1ngg/forge-agent) when designing
and implementing the Agent Core. The user authorizes reporting problems
encountered during use to that repository as issues and resolving them locally
in My-RAG. This authorization persists for relevant integration work and does
not require repeated routine confirmation.

Inspect current source and SDK contracts before choosing the reuse approach.
The [reuse investigation](research/forge-agent-reuse.md) records the inspected
revision, controlled verification and integration gaps. Under the component-
selection delegation, [ADR-0003](adr/0003-forge-agent-sdk-and-bun-host.md) chooses
direct SDK reuse and a TypeScript/Bun backend, superseding the assistant's earlier
Python/custom-loop defaults. Keep local patches attributable and report confirmed
defects or required enhancements accurately; do not manufacture a defect report
for ordinary host responsibilities.

### Q39: Construction specification, modules and aligned work items

Requested by the user on 2026-09-10 through ask-matt.

Consolidate the redesign discussion into a construction blueprint, split it into
smaller modules, and align/refine the plan. Continue the prior delegation of
routine design and evaluation choices rather than restarting individual approval
questions. The current request is planning and refinement, not implementation.

The [construction specification](../.scratch/rag-v1/spec.md) owns the consolidated
product outcomes. The [module map](design/rag-v1/README.md) separates nine owned
interfaces, with shared source validity, budget, operation and settlement
contracts. [Alignment notes](design/rag-v1/alignment.md) record the first pass's
clarifications. The [local work-item map](../.scratch/rag-v1/README.md) splits
delivery into 17 vertical slices with explicit blockers.

Use local Markdown tracking because this directory has no configured Git root
or remote. Routine tracker and granularity choices are made under Q36; source
publication authorization for Forge issues under Q38 is separate. A work item's
ready-for-agent status means it is scoped for later execution, not already built
or authorized to run against production.

### Q40: Product and repository name

Confirmed by the user on 2026-09-10.

The redesigned product is named **LoreWeave**, with repository slug
**`loreweave`**. Use this name in the construction blueprint and specification.
Earlier references to My-RAG describe the existing project or its historical
discussion; the name does not change the confirmed product scope.

Suggested repository description:

> An agent-powered knowledge base with a living wiki, graph-assisted retrieval, and source-backed answers.

This records the naming decision. GitHub repository creation and publication
remain separate actions; this decision does not rename the local directory or
existing implementation packages.

### Q41: Retire the old repository baseline before product implementation

The user approved adding this prerequisite on 2026-09-10.

Track repository retirement in [work item 00 / #19](https://github.com/L-1ngg/loreweave/issues/19)
under the [GitHub specification](https://github.com/L-1ngg/loreweave/issues/1).
It blocks the first product slice, #2, while preserving the original 01–17
work-item numbering and the nine-module design.

Preserve a remotely recoverable Git baseline, then remove retired Python code,
interfaces, dependencies and tooling from the active tree. Retain useful behavior
cases for the assigned new-system tests; archive superseded designs and historical
evaluation evidence. Make current repository entry points agree with the actual
post-cleanup tree. Deferred capabilities stay scope notes rather than empty
modules or speculative interfaces. Application bootstrap belongs to #2.

Existing databases, object-store contents, running services, untracked local files
and credentials are outside this repository task. This approval adds the work
item and its dependency; no cleanup or product implementation has been executed.

### Q42: Specify Wiki candidate retrieval and topic creation

Requested by the user on 2026-09-10; numeric defaults are assistant-selected
under the existing routine-design delegation.

The [M05 topic maintenance policy](design/rag-v1/policies/wiki-topic-maintenance.md)
specifies two streams: exhaustive dependency revalidation in 20-page cursor
batches and source-packet topic discovery. Four catalogue routes retrieve up to
20 cards each, RRF retains 40, and topic inspection expands from 8 to at most 16
cards with detailed checks of at most 3 pages. These caps bound one decision,
not the total pages affected by a source update.

Prefer source-supported reuse/linking. New pages require an independently useful
question, sufficient original support, completed bounded candidate inspection,
ready search coverage and a duplicate check. Uncertain decisions are deferred
with reasons. Catalogue revisions/reservations protect concurrent publication;
bounded search and model judgment do not guarantee zero duplicate topics.

Extend GitHub spec #1 and the existing Wiki, recovery and evaluation work items
without adding a module or starting implementation. Historical local spec/ticket
snapshots stay unchanged. The policy records measurable examples and configurable
defaults; it does not claim evaluated performance or a Wiki-refresh SLA.

## Remaining preparation and execution boundaries

- Routine design defaults are owned by the blueprint and do not require another
  round of individual confirmations.
- Assemble the actual source corpus and evaluation artifacts; languages, length
  distribution, update frequency, and historical volume need observation rather
  than invented production facts.
- Select concrete models and production resources using measured candidates and
  available deployment and spending constraints.
- Resolve exact schemas, dependency versions, tool contracts and validation
  mechanics during implementation preparation under the design defaults.
- Implementation, paid execution, deployment and any destructive cutover remain
  separate from the design work authorized here.
