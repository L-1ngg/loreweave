# LLM Wiki and GraphRAG Feasibility

Investigated: 2026-09-09. Status: proposal for discussion, not an accepted
architecture. No prototype, migration, or model evaluation was run.

User-confirmed goals and decisions are owned by
[the design discussion](../rag-optimization-design.md).

## Assessment

Combining a maintained Wiki with graph-assisted retrieval is technically
plausible and worth testing as a knowledge-work product. Its usefulness for this
corpus, maintenance workload, and users is unproven. The two additions must be
evaluated separately and together against a competent retrieval baseline.

The product hypothesis is that continuously integrating sources into reusable
pages, while retaining relationships and original evidence, can improve repeated
research, navigation, and cross-document questions. Specific fact and rule
queries remain an important workload and regression slice.

## Primary-source findings

### LLM Wiki

Karpathy describes immutable raw sources, an LLM-maintained collection of linked
Markdown pages, and conventions governing ingestion, querying, and maintenance.
Ingestion may update several existing pages; useful query results may become
new pages. Periodic checks look for contradictions, stale claims, missing links,
and knowledge gaps. This is an idea and workflow description, not a benchmarked
implementation or a guarantee of automatic consistency. GraphRAG is not a
required dependency. [S1]

### GraphRAG

Microsoft's Local Search combines entities, relationships, community reports,
and associated original text units within a context budget. Global Search uses
community reports in a map-reduce process. These support different question
types; neither requires a human-facing Wiki. [S2, S3]

The Bring Your Own Graph workflow accepts entity and relationship tables from
an existing extraction process. Community creation and report generation can run
without repeating source chunking and graph extraction. Local, DRIFT, and Basic
Search additionally need text units and appropriate embeddings. Thus a shared
source model can feed both Wiki and graph workflows. This is integration
feasibility, not a tested adapter for My-RAG. [S4]

Entity and relationship tables carry text-unit references, and text units map
back to documents. Community reports and consolidated descriptions are generated
content. Existing provenance fields enable navigation, but do not by themselves
prove that every generated claim is supported. [S5]

GraphRAG denotes a family of graph-assisted retrieval approaches here. Choosing
the Microsoft library, a graph database, or a custom implementation is a later
decision. The documented Microsoft workflow uses tables and does not itself
establish a requirement for a dedicated graph database. [S4, S5]

## Candidate integration designs

| Design | Advantage | Main trade-off |
| --- | --- | --- |
| Generate Wiki, then extract a graph from Wiki pages | Straightforward exploratory pipeline | Adds another interpretation step; source details and qualifiers may already be absent from the Wiki. Original evidence must remain accessible. |
| Generate a graph and reports, then render Wiki pages from them | Reuses graph outputs and descriptions | Graph communities need not match useful editorial topics; a richer Wiki maintenance workflow is still needed. |
| Share source identities, evidence references, and entity identities across Wiki and graph derivations | Supports consistent provenance and targeted updates | Requires explicit ownership, dependency tracking, and adapters between representations. |

The third option is the recommended hypothesis for a durable system, pending
user confirmation. Begin with the smallest shared records the experiments need;
do not assume a complete ontology or triple representation can preserve every
rule, exception, or argument in prose.

Candidate information flow:

```text
Versioned original sources and addressable evidence
  -> extraction with source references, entities, and qualified assertions
     -> maintained Wiki pages and cross-references
     -> relationship graph and optional community reports
  -> original-evidence search index

Question
  -> select relevant page, graph, and/or original-evidence retrieval
  -> assemble evidence under a context budget
  -> cited answer or explicit evidence gaps
```

Generated assertions are interpretations, not automatically verified facts.
Keep source statements, inferred conclusions, and unresolved conflicts
distinguishable. A generated answer filed into the Wiki must retain its original
evidence dependencies; it must not become independent corroboration of itself.

## Lifecycle questions the design must settle

- Source revisions: which pages, assertions, graph edges, and reports become
  stale, and how quickly are they refreshed?
- Conflicts: do two statements concern different dates or conditions, or is
  there a genuine unresolved disagreement? Preserve both sources when unresolved.
- Retractions and deletions: which derived content must stop supporting current
  answers, and what historical material should remain addressable?
- Editorial changes: if humans can edit Wiki content, how are those edits
  preserved or reconciled with subsequent regeneration?
- Publication: which version of the derived knowledge may queries observe
  while background updates are incomplete?

These are engineering requirements inferred from the proposed product, not
capabilities established by the cited idea file or by the existence of graph
provenance fields.

## Current project starting points

The current source model already includes document revisions, source hashes,
original blocks, section/page locations, and immutable chunk artifacts. The
database tracks active revisions and an outbox for search projection. These
provide useful starting points for source identity and reproducible derivation.
[L1, L2, L3]

The entity registry currently provides canonical names, aliases, and links to
document revisions. It is not yet the extracted relationship graph described
above. Wiki pages, supported assertions, derivation dependencies, and their
update lifecycle would require new design and implementation. [L1, L2]

Reuse of individual modules and storage choices remains subject to that design;
this study does not approve a migration or establish live service health.

## Proposed validation

Use a corpus with recurring entities, overlapping topics, cross-document
questions, and deliberate source revisions. Include specific fact/rule queries,
relationship questions, synthesis tasks, exceptions, and unanswerable questions.

Compare four configurations on the same source snapshot and reviewed questions:

| Configuration | Purpose |
| --- | --- |
| Hybrid retrieval, rerank, and original evidence | Establish a credible baseline. |
| Baseline plus maintained Wiki | Measure reuse and the effect of organized pages. |
| Baseline plus graph retrieval | Measure the effect of relationships and community information. |
| Baseline plus Wiki and graph retrieval | Test whether the combination adds value beyond either component alone. |

Keep generation and underlying retrieval settings fixed where applicable, and
record extra calls and tokens introduced by each component. Judge answer
correctness, necessary-evidence coverage, source support, and citation validity
by question type. Record query latency and cost separately from initial build,
update latency, and maintenance cost.

Repeat the comparison after modifying a rule, adding a conflicting source, and
retracting a source. Measure stale-answer rate and affected-page/edge correctness.
If directly browsable Wiki pages become a product goal, also evaluate navigation
and whether users can find and reuse useful knowledge; QA scores alone do not
measure that value.

Retain the combined design only if it offers a useful quality, workflow, or
amortized-cost advantage over the simpler candidates while preserving required
correctness. Numeric acceptance targets, workload proportions, and latency
budgets require user decisions before implementation.

## Sources

- S1: [Karpathy, LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), inspected revision `6b0cef32d73931fcab7498a7e82208e3ea41ee6f`.
- S2: [Microsoft GraphRAG Local Search](https://microsoft.github.io/graphrag/query/local_search/).
- S3: [Microsoft GraphRAG Global Search](https://microsoft.github.io/graphrag/query/global_search/).
- S4: [Microsoft GraphRAG Bring Your Own Graph](https://microsoft.github.io/graphrag/index/byog/).
- S5: [Microsoft GraphRAG Output Schemas](https://microsoft.github.io/graphrag/index/outputs/).
- L1: [Current domain models](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/domain/models.py).
- L2: [Current database models and lifecycle](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/infrastructure/database.py).
- L3: [Current immutable chunk artifacts](https://github.com/L-1ngg/loreweave/blob/d24fb0bce6e240930bba9940ead57f371601ded8/src/rag_system/processing/artifacts.py).
