# Evidence validation and final-answer admission

Status: design defaults selected on 2026-09-10 to close the whole-design review.
M06 owns answer validation; M05/M04 use the same support semantics for publication.
Model-based review is fallible. Passing checks is not proof of real-world truth.

## V01: Claim manifest and support review

A generated candidate contains an immutable draft, its hash, and a claim manifest.
Each material factual claim has an ID, exact draft span, cited evidence handles,
subject/scope, relevant time/environment/conditions and an attribution or inference
marker when applicable. Questions, operation receipts and gap messages have explicit
non-factual roles. Source text and generated text cannot grant tool authority.

Before semantic review, deterministically check schema, span coverage/overlap,
handle resolution, source locators, trusted scope and current source/identity
validity. The reviewer receives the entire rendered draft, claim manifest and
original evidence with necessary context, not just generated summaries. It must
also detect factual assertions omitted from the manifest. A forged handle, missing
claim, malformed review or stale dependency cannot be interpreted as a pass.

Use a separate tools-disabled review request with a versioned review prompt. A
separate request may use the same configured model; it is not independent factual
corroboration. Return for every claim:

| Result | Meaning and permitted handling |
| --- | --- |
| supported | Original passages support the actual statement, its subject, scope and qualifications. Eligible for final admission after freshness checks. |
| contradicted | Applicable evidence contradicts the stated claim. Repair or omit; never publish it as stated. |
| insufficient | Evidence, context, identity or inference support is inadequate. Repair, return a supported subset, or report a gap. |

Each result identifies exact original supporting/contradicting spans and a short
reason. Multiple premises must each have evidence; a graph path alone does not
establish a conclusion. Explicitly attributed conflicting statements can both be
supported, while silently choosing one as universally true cannot. Source support
means faithful representation of supplied knowledge, not verification that its
authors are correct. Reviewer confidence numbers are not admission thresholds.

For interactive answers, use at most 24 material claims within the existing
1,500-token generation-output ceiling (draft and manifest together) and
8,000/16,000-token evidence budgets. Bound interactive review output to 2,000
tokens; malformed or truncated reports are not a pass. If a required
claim/context cannot fit, disclose incomplete coverage. Publication of larger
Wiki artifacts uses independently reviewable blocks of at most 4,000 generated
text tokens, with original context fitting the selected model. Review headings,
links with factual labels and cross-block assertions too; compose only validated
blocks, never add an unreviewed free-form summary. Block reports bind exact text
and evidence hashes, and the whole page edit set publishes atomically.

A review certificate records draft/block hash, claim results, evidence versions,
identity proof revisions, model/prompt/policy versions and check time. Any edited
text or relevant evidence change invalidates its certificate. Reviewer errors or
timeouts produce no certificate. Deterministic rendering of an already-reviewed
subset is permitted only when retained claims remain understandable, all necessary
qualifications/premises are retained, and a final mechanical check still passes.
Keep per-claim dependency sets for this admission step: a changed unrelated claim
does not invalidate an unchanged reviewed claim with its full premises. The old
whole-draft certificate cannot certify a new draft. Record the retained subset
and its checks separately; this is not finer-grained Wiki freshness indexing.
Otherwise return a deterministic gap/partial-status message without invented facts.

## V02: Interactive call budgets and repairs

C05 keeps the 30/60-second hard deadlines, ordinary p95 target of 15 seconds,
8/15-second finalization reserve, and 2/3 total retrieval rounds. Revise the old
single-call finalization default as follows:

- At most three exploration LLM requests, including Forge retries and summaries.
- At most two final-generation requests and two semantic-review requests: four
  finalization LLM requests total. The normal path is one generation plus one
  review; the remaining pair is optional repair or source-refresh regeneration.
- Provider retries consume their corresponding generation/review slot. Retrying
  a failed review can exhaust the review budget and therefore preclude repair.
  Never start a new draft when there is no review slot left to certify it.
- Every LLM call is admitted before dispatch and charged to the same deadline;
  the maximum is seven LLM requests across exploration and finalization, not
  seven required calls. Embedding requests and non-LLM tools are recorded
  separately and obey the same deadline and provider admission limits.

The extra review request can increase latency and must be measured; numerical
quality/latency targets remain unchanged. A remaining slot never extends time.
Receipts/clarifications composed deterministically from domain outcomes need no
LLM review. Draft repair receives failed claims and original evidence; the whole
changed draft is reviewed again. If repair/time is exhausted, admit only a valid
supported subset or return an explicit gap/failure, and score incomplete answers
as such. No automatic review outage bypass is allowed.

For Wiki publication, each bounded draft block has at most three generation
requests (initial plus repair/provider retries) and three review requests, six
LLM requests total. A repair requires a remaining review slot. Persist all counts
under the same candidate operation across worker restarts; successful blocks can
be reused only at identical text/evidence hashes. Graph packet limits are owned
by the graph maintenance policy. Every actual review request is costed and counted.

## V03: Source changes during finalization

| Phase | Permitted next step |
| --- | --- |
| executing | Bounded exploration, then finalizing. |
| finalizing | Generate/review with tools disabled; deliver after final dependency admission, or enter refreshing once for changed support. |
| refreshing | M06 performs host-controlled read-only evidence refresh using one unused original retrieval round; then returns to finalizing. |
| terminal outcome | No new model or retrieval work; execution settlement may continue under C04. |

Refreshing is the sole exception to the ordinary finalization retrieval ban.
It never resumes Forge's planning/tool loop or permits knowledge mutations. Mark
the old draft superseded, keep one `refresh_used` flag for the entire run, and
revalidate newly assembled evidence. If generation is still in flight, abort and
settle it before replacement work; its attempt remains charged. Regeneration and
re-review consume the remaining V02 slots. A refresh and an ordinary repair share
the same remaining generation/review allowance, not separate retry budgets.

If no retrieval round, generation/review capacity or time remains, or a second
source change occurs, return a still-valid supported subset or a source-change
gap. Never reuse old text with replacement citation handles. Do one final
source/identity eligibility check, freeze versions and validated_at, then deliver.
Historical answers retain this snapshot; no continuous-delivery freshness claim
is made. Streamed drafts/progress remain provisional and can be superseded.

## V04: Required verification

#2 owns phase/call admission with fixtures; #6 owns actual support checking;
#7 and #13 own source-change behavior; #9/#12 own publication review; #16 owns
persisted maintenance counts. Check: valid citation with the wrong number; omitted
negation/environment; unsupported transitive inference; factual text omitted from
a claim manifest; reviewer timeout; repair followed by review; source change before,
during and after review; a second source change; and retries consuming the final
review slot. Count actual provider requests and verify that no unreviewed draft
is delivered. Human acceptance review remains separate from this online mechanism.

The following budget walkthroughs constrain implementation acceptance; they are
not executed provider results (G = generation request, R = review request):

| Scenario | Maximum work on that path | Admission result |
| --- | --- | --- |
| Normal supported draft | G1, R1 | Deliver after final freshness check |
| Unsupported claim repaired | G1, R1, G2, R2 | Changed whole draft must pass R2 |
| R1 transport failure, retry succeeds | G1, R1, R2 | No review capacity remains for another draft |
| Source changes while G1 runs | G1 charged/settled, one refresh, G2, R1 | Replacement must pass review and freshness |
| Source changes after R1 | G1, R1, one refresh, G2, R2 | Same remaining slots; no added pair |
| Source changes after successful repair | G1, R1, G2, R2 already consumed | No regeneration; valid reviewed subset or gap |
| Second source change | No second refresh | Valid reviewed subset or gap |

All paths also require a remaining original retrieval round for refresh and
remaining wall time; the listed slots do not override either condition.
