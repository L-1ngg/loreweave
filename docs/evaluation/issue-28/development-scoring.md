# Issue 28: independent agent development scoring

This is **independent agent development scoring**, based on the frozen artifacts below. The scoring agent read the source corpus, expected outcomes, delivered answer text, citations, diagnostics, and transport records; it did not generate the evaluated answers or change the implementation. This is not human review, a blinded holdout, or formal issue #18 semantic, capacity, or HA acceptance. Both runs are development iterations on the same six disclosed questions. The rerun therefore cannot establish generalization or a causal performance improvement.

The v3 run delivered an answer for 5/6 cases, compared with 3/6 in v2. The mixed general/project question still failed delivery. The most serious delivered v2 error was choosing 30 days as authoritative despite unresolved 30/60-day evidence. V3 stopped choosing a winner, but still strengthened “does not declare supersession” into “declares non-supersession” and attached incomplete citations to its missing-budget answer. Passing deterministic citation traceability did not establish semantic support.

## Frozen evidence and method

- [v2 inputs](direct-development-v2/frozen-inputs.json), SHA256 `7c7ed7e1caac93505b8e659a1c40c9e48df7b52c8d54ac2c6450295b64e3f618`.
- [v2 results](direct-development-v2/results.json), SHA256 `f62b33805b4da245b47911d72409b621cd11d4223520b5b7d2fe34d03ee82b87`.
- [v3 inputs](direct-development-v3/frozen-inputs.json), identical SHA256 to v2 inputs.
- [v3 results](direct-development-v3/results.json), SHA256 `214454e8749f548bcc8e59699edbb69c6b944e3b131110eb45595278d70a5406`.

Both runs identify answer model `deepseek-ai/DeepSeek-V4-Flash` and embedding profile `openai-embeddings:BAAI/bge-m3:1024:c42cd75fca5cd5f36e1564dee3729c85b6d8315b851c8764386432d05a15544e`. The corpus has two short Chinese documents: operations specifies production logs 30 days, debug logs 7 days, and release approval by 陈明; audit specifies production logs 60 days and says it has not declared that it supersedes or abolishes operations. Neither contains an annual audit budget. No source establishes which production-log rule wins.

Scores are ordinal: **2** meets the case requirement, **1** is useful but has a material limitation, **0** fails it. `N/A` means the dimension does not apply; `ND` means no delivered answer exists to assess semantic correctness, citation support, or conflict handling. Completeness is 0 for nondelivery. Scores assess the delivered answer, not an inaccessible rejected provider draft. Route utility assesses observed retrieval usefulness only, independently of whether answer delivery succeeded. No aggregate semantic pass rate is inferred from these dimension scores.

Citation semantic support checks whether the cited text supports the actual wording. Valid source handles, offsets, and `semanticReview: false` are not semantic endorsements. For missing evidence, the known finite corpus permits checking that no budget was supplied, but a citation to a heading or unrelated paragraph alone cannot prove exhaustive absence.

## Case scores

### v2

| Case | Correctness | Completeness | Citation semantic support | Conflict handling | Route utility | Evidence and decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| general | 2 | 2 | N/A | N/A | 2 | Appropriate introductory database-index explanation, with costs and the exact `通识回答，未查询知识库` label. No retrieval was needed. The explanation is introductory rather than a guarantee that every index avoids a table scan. |
| supported | 0 | 1 | 1 | 0 | 2 | Both 30 and 60 days are correctly retrieved and cited, but “运维规则中的 30 天应是现行有效值” is unsupported. Lack of a supersession declaration does not establish authority. The `partial` status does not repair this erroneous answer. |
| precise | 2 | 2 | 2 | N/A | 2 | Answers 7 days and cites the operations passage containing that value. Additional production-log and approver details are unnecessary but present in the cited source. |
| missing | ND | 0 | ND | ND | 1 | No answer: `timed_out / budget_exhausted` after 6.727 seconds. Two retrievals found the same small corpus without budget evidence; the run failed to deliver the required explicit absence response. This was not a measured 30-second wall-clock deadline. |
| mixed | ND | 0 | ND | ND | 1 | No answer: `failed / invalid_draft`. Source returned relevant originals; the requested Wiki route was unavailable. Neither a mixed-answer quality pass nor Wiki utility follows from that fallback. |
| relation | ND | 0 | ND | ND | 2 | No answer: `failed / invalid_citation`, despite source retrieval containing the approver fact. Retrieval was sufficient for this simple relationship question, but the user did not receive the answer. |

### v3

| Case | Correctness | Completeness | Citation semantic support | Conflict handling | Route utility | Evidence and decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| general | 2 | 2 | N/A | N/A | 2 | Relevant general explanation and exact no-retrieval label, with zero retrievals. |
| supported | 1 | 2 | 1 | 2 | Correctly reports the 30/60-day conflict and says current authority cannot be determined. However, “且声明：本规则没有覆盖或废止运维规则” strengthens the source's “没有声明覆盖或废止”; the distinction matters to policy authority. Repeated summaries add noise. |
| precise | 1 | 2 | 1 | 1 | Correct main answer: 7 days, supported by operations. Adds unrelated production-log conflict and repeats the stronger “明确声明未覆盖运维规则” interpretation. The prompt's narrow question did not require resolving or explaining that conflict. |
| missing | 1 | 2 | 1 | 1 | Correctly declines to invent a budget and limits absence to retrieved material. But it repeats the non-supersession overstatement, adds irrelevant production-log conflict, and formally cites only audit heading `e1` and audit passage `e3`; operations facts use `e4` in plain parentheses at the end without an emitted `e4` citation. The retrieved operations passage supports those numbers, but the answer's emitted citations do not cover them. |
| mixed | ND | 0 | ND | ND | 2 | Still no answer: `failed / invalid_draft`, even though source retrieval contains the required 7-day fact. Mixed general/project explanation remains unverified. |
| relation | 2 | 2 | 2 | N/A | 2 | Correctly answers 陈明 with the original operations passage. A final `来源：[e3]` supports this single claim; this does not validate claim-level citation placement for longer answers. |

The supported and precise questions have factual evidence available in both versions, while the missing question deliberately does not. Declining to invent the budget is desirable; returning a technical failure instead of an explicit evidence gap is not counted as successful delivery.

## Delivery, latency, and transport

Delivery means an emitted `answer` with terminal status `answered` or `partial`; it does not mean semantic correctness. All six cases, including failures, remain in the latency denominator. The nearest-rank p95 is sorted observation `ceil(0.95 × 6) = 6`, hence the maximum. A six-case single run is too small to estimate service p95 reliably.

| Metric | v2 | v3 |
| --- | ---: | ---: |
| Delivered | 3/6 (50.0%) | 5/6 (83.3%) |
| `answered` / `partial` | 2 / 1 | 3 / 2 |
| Failed or timed out | 3/6 | 1/6 |
| Nearest-rank p95, all six cases | 21,129.639 ms | 14,066.562 ms |
| Cases over 15,000 ms | 1/6 | 0/6 |
| Dispatched HTTP requests in answer-run transport records | 18 | 19 |
| Agent exploration calls / query embedding requests | 12 / 6 | 13 / 6 |
| Online semantic review calls | 0 | 0 |
| Provider monetary cost | unavailable | unavailable |

The HTTP counts use transport rows with a recorded `dispatched_at`, not logical retrieval calls. All 37 recorded rows have terminal `settled` state and `http_200` outcome. They include answer-run query embeddings and Agent calls, but exclude corpus preparation and any unrelated process traffic. No uncertain request is present in these artifacts; this does not test quarantine recovery. Provider request IDs are null, and no token usage, tariff, or billed-cost evidence is provided, so cost is unavailable rather than zero.

| Case | v2 elapsed ms | v2 HTTP | v2 terminal result | v3 elapsed ms | v3 HTTP | v3 terminal result |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| general | 11,879.333 | 1 | answered | 6,178.907 | 1 | answered |
| supported | 21,129.639 | 3 | partial / evidence_gap | 5,799.703 | 3 | partial / evidence_gap |
| precise | 4,372.888 | 3 | answered | 5,283.001 | 3 | answered |
| missing | 6,727.294 | 5 | timed_out / budget_exhausted | 14,066.562 | 6 | partial / evidence_gap |
| mixed | 8,608.170 | 3 | failed / invalid_draft | 9,852.615 | 3 | failed / invalid_draft |
| relation | 3,912.482 | 3 | failed / invalid_citation | 5,290.251 | 3 | answered |

V3 meets the 15-second target only as a descriptive result for this six-case development sample. It cannot establish production latency, capacity, or semantic acceptance. The missing case improved delivery while consuming an extra HTTP request and more than twice its previous elapsed time; aggregate latency alone would hide that tradeoff.

## Route and acceptance limits

The environment provides usable source evidence without Wiki/graph readiness. V2's mixed case requested `source` and `wiki`; Wiki reported `unavailable` with zero originals and candidates. All other retrievals requested only `source`, and v3 requested only `source` throughout. No graph traversal, ready Wiki packet, multi-route comparison, or distinct Wiki/graph semantic contribution was observed. Answering a simple approver question from source is useful, but is not evidence that graph routing passed.

These artifacts therefore demonstrate a small amount of real-provider source retrieval and direct-answer delivery, plus concrete failures to address. They do not establish mixed-answer reliability, complete citation entailment, robust conflict interpretation, semantic route utility across ready routes, long-context behavior, concurrency ceilings, ingestion scale, or HA recovery. Formal issue #18 acceptance remains outstanding; this report does not close issue #28 or authorize remote changes.
