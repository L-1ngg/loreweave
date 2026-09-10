# Source retrieval and answer admission

Issue [#6](https://github.com/L-1ngg/loreweave/issues/6) connects imported originals
to Forge conversations. M02 owns PostgreSQL search and pointer checks; M06 owns
run-scoped evidence handles, rank fusion, claim manifests and answer certificates.
The host supplies the original deadline, request admission and phase counters.

Search queries use the same Jieba/technical lexical derivation and pinned embedding
profile as source preparation. Each route retrieves up to 50 distinct passages:
lexical matching/rank over the GIN-indexed tsvector, and exact pgvector cosine
distance. RRF uses k=60 and deduplicates by source version/passage, without treating
two routes as independent corroboration. Vector comparison only uses matching
profile/dimensions; lexical evidence remains independently addressable. No ANN or
reranker tuning claim is made.

Evidence assembly includes immutable original blocks, heading paths, the document's
first three blocks and immediate neighboring blocks. This bounded context helps
retain prefatory applicability/qualification; it cannot guarantee all distant
premises were retrieved. The pack reports context-limit and unavailable-Wiki gaps.
Conservative UTF-8 byte budgets bound evidence at the 8,000/16,000-token ceilings
without assuming a provider tokenizer. They can admit fewer useful tokens than a
model-aware tokenizer. Oversized original blocks are omitted with a context gap,
not silently truncated or rewritten. Final review still decides support sufficiency.

Generation returns text and exact nonoverlapping spans covering every non-whitespace
character. Claims carry handles, subject/scope, conditions, attribution and premise
IDs. Cyclic or missing premises, fabricated handles and malformed spans fail
mechanical checks. Original locators and authoritative active pointers are checked
in one PostgreSQL statement, including again after review. All evidence is bound
to a registered pack; changing the supplied pack cannot mint valid references.

The separate tools-disabled review receives the complete draft/manifest/originals
and a versioned prompt. It reports supported/contradicted/insufficient verdicts,
exact original spans and unlisted assertions. A certificate binds the draft hash,
evidence hash and versions, review report, model/prompt/policy IDs and check time.
Identity revisions are empty for source-only answers. Review failures cannot pass.
The conservative response-byte limits remain inside 1,500 generation and 2,000
review token ceilings; claim count is at most 24.

Normal finalization takes G1/R1. Repair requires remaining generation and review
slots and re-reviews the changed whole draft. Review transport/malformed-result
retries consume review slots and can prevent repair; no new draft starts without
review capacity. There are at most two generation and two review requests, sharing
Forge's run deadline. Exploration embedding and SQL reads combine SDK cancellation,
the exploration cutoff and the run deadline; they cannot consume the reserved
finalization window. A source change prevents delivery; controlled refresh is #7.
A partial answer can retain only unchanged, independently understandable reviewed
claims whose premises remain present. It records a separate subset hash/retained
claim list referencing the original report, not a whole-draft certificate for
edited text. Gaps and bounded coverage remain partial outcomes.

`RunSnapshot.diagnostics` records queue/elapsed/retrieval/generation/review timings,
lexical/vector candidates, embedding attempts and coverage gaps. LLM admissions
remain in `counts`; failed attempts consume capacity. Browser “开发诊断” exposes these
as development data. Provider/retrieval unavailability is separate from insufficient
evidence. Citation links include immutable passage anchors. Partial outcomes remain
terminal product results while cleanup/settlement still completes.

The default runtime uses `ControlledEmbeddings` and a scripted extractive oracle.
The oracle quotes matching originals with attribution and rejects nonmatching
fixture statements; it is not a learned semantic reviewer. Tests use additional
controlled semantic coordinates and adversarial generator/reviewer responses over
real PostgreSQL/HTTP/Forge seams. They establish fusion, isolation, immutable
references, request limits and fail-closed admission, not general paraphrase or
hallucination rates. No paid provider or frozen acceptance evaluation was run.
