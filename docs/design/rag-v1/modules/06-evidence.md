# M06: Evidence and answers

M06 owns the transition from retrieval candidates to a supported product answer.
Its evidence registry is authoritative for citation handles within a run.

## Interface

- Retrieve an evidence pack for a question, trusted scope, requested routes and
  remaining budget, with explicit gaps and coverage diagnostics.
- Resolve/revalidate an evidence pack's source and identity dependencies.
- Finalize an answer from the evidence pack with tools disabled, or return a
  supported partial/insufficient-evidence result.

## Ownership and dependencies

Own run-scoped evidence handles, ranking/fusion decisions, answer validation
records and final citation mappings. Read M02 source search, M05 Wiki search and
M04 graph neighborhoods; consult M03 validity as needed. Receive model and budget
adapters. M07 owns the run, so M06 does not create a second deadline or retry loop.

## Invariants and failure behavior

Ordinary queries use source and Wiki retrieval; explicit relationship questions
include graph retrieval immediately. An absent derived representation is a
coverage limitation, not absence of original evidence. Deduplicate by original
source-version/passage; Wiki and graph citing one passage do not corroborate
each other independently.

Preserve qualifications and competing applicable claims. Fit originals plus
necessary context into the 8,000/16,000-token initial evidence caps, reduced for
the model context. Wiki summaries cannot replace missing original support.
Lexical/vector rank fusion defaults to RRF; reranking is an evaluated option.

Follow [V01–V04](../policies/evidence-validation.md): generate an immutable draft
with a claim manifest, validate references deterministically, and separately
review the full draft against original passages for support, qualifiers, conflicts
and omitted claims. Bind the certificate to exact text and dependency hashes.
C05 permits two generation and two review requests, including repair or the one
host-controlled refresh; it grants no extra deadline or retrieval round. Record
evidence versions and validated_at. Fail closed on review failure and only emit
reviewed still-supported subsets or a gap. Partial answers do not count as complete.

## Acceptance boundary

Through the answer interface, check facts, scope, multi-source qualification,
conflicts and genuine no-answer cases. Inject fabricated citation handles and
change a source during generation. Verify final output rejects invalid claims,
respects the original deadline and records diagnostics without leaking them as
source facts.
