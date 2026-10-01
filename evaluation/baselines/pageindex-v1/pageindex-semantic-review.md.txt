# Original-evidence review of real answers

Reviewed 2026-10-01 by the implementation agent against immutable original page
text in [the full real trial](pageindex-real.json) and
[the targeted regression](pageindex-real-regression.json). This is an agent
review, not a blind independent reviewer, model-judge score or population estimate.
The [frozen questions](../../tests/fixtures/questions.json) state original facts
and expected physical pages, rather than model-authored gold answers.

## Review rule and cohort

For a factual answer, inspect its amounts/year/company/currency/business scope,
audit/subsidiary qualifications and any arithmetic, then inspect each cited page
and the claim next to its citation. An evidence-gap answer must describe the
actually inspected evidence without guessing the missing employee count. A
clarification must avoid silently selecting an unspecified report. Source/location
validity remains the server's independently tested run-read contract.

The final reviewed cohort selects the latest measured result for each
`mode/question ID`: full-trial results plus targeted revenue/long-navigation/
20–21-page/Chinese/MCP results. Earlier failures are retained and reported below;
this is not a claim that all 24 outcomes passed in one uninterrupted first trial.
Follow-up remains the original trial's two-turn conversation, with fresh original
reads in its second run. Each mode has 11 Web questions and one independent
official-client MCP question. Those 24 outcomes comprise 20 factual answers,
two evidence gaps and two clarifications.

## Claim and citation findings

| Question | Flash | Standard | Original support and qualification |
| --- | --- | --- | --- |
| revenue | Supported | Supported | `single-column` p2/p1 respectively explicitly says 2026, 120 million USD, domestic only and no subsidiaries. “USD 120 million” is equivalent to the fixed fact “120 million USD”; lexical substring failure is not a correctness failure. |
| follow-up | Supported, wording caveat | Supported | Both reread p4 for audited domestic-only 2025 revenue 100 million USD and net profit 9 million USD, and p1 for the prior 2026 scope. Flash's “matches the domestic-operations scope” is weaker than Standard's explicit statement that 2025 does not separately repeat the subsidiary exclusion; neither transfers the 2025 audit label to 2026. |
| missing-fact | Appropriate gap | Appropriate gap | Both read all six original pages and found no employee disclosure. References to revenue pages establish the disclosed financial content, not a universal proof of absence; the answer is limited to the supplied document. No invented count or revenue→headcount inference. |
| printed-toc | Supported | Supported | Revenue 100 million USD, net profit 9 million USD and audited domestic-only qualifier are on `toc-offset` physical p5. Standard separately identifies printed label 3. Neither links the citation to printed page 3. |
| long-navigation | Supported | Supported | Distinct original reads/citations on `no-toc` p1 (2026: 120 million USD, subsidiaries excluded) and p11 (2025: 100 million USD, audited domestic-only). Targeted answers explicitly leave 2025 subsidiary treatment unspecified. Derived difference 20 million USD/20% is correct and identified as calculated from those figures. |
| mixed-20-21 | Supported | Supported | Separate p1 citations from `boundary-20` and `no-toc`, each 120 million USD/domestic-only/excluding subsidiaries. Original identity and per-document 20/21 tree policy remain separate; amounts are not added. |
| cjk-qualifiers | Supported | Supported | `mixed-cjk` p1: 上海公司2026年120万元/境内业务; 2025年100万元; difference 20万元/20%. Both correctly disclose that the original does not name the currency, and do not assume RMB or add USD. Flash explicitly notes 2025 scope is not separately stated. Standard's condensed scope wording refers to the 2026 clause. |
| conflict | Supported | Supported | `single-column` p1 has 120 million USD; `conflicting-source` p1 has 130 million USD and 2026 audit wording. `single-column` p4 (also p6 in Flash) confines its audit phrase to 2025. Both preserve the unresolved 10 million difference without choosing, averaging or pretending a reconciliation exists. |
| distinct-sources | Supported | Supported | Separate `single-column` p1 120 million USD/domestic/no subsidiaries and `other-company` p1 Beta 999 million EUR/global/including subsidiaries. Both preserve company and currency and do not total them. |
| library-clear | Supported | Supported | The named Beta report is discovered; `other-company` p1 supports 999 million EUR/global/including subsidiaries. No equally plausible unrelated source is silently substituted. |
| library-ambiguous | Appropriate clarification | Appropriate clarification | Both ask for company/year and give no factual revenue answer or fabricated citation. This question intentionally supplies no target. |
| mcp-revenue | Supported | Supported | Independent official-client question_answer returns 120 million USD/domestic/no subsidiaries; cited immutable `single-column` p2/p1 respectively has all qualifiers. Returned references include additional pages read; only the claim's cited page is scored for semantic support. |

All 24 final reviewed outcomes meet their fixed question's expected behavior.
All 20 factual answers have claim-adjacent original support. This descriptive
24-case finding does not measure general PDF-domain answer accuracy. Missing-fact
and clarification cases are reported separately from positive factual precision.

## Defects and earlier trials

The [initial trial](pageindex-real-initial.json) failed long-navigation citation
validation because the model produced native citation markers. The application
did not transform them into validated references or release a final answer.
The Markdown/reference schema and prompt were made explicit; subsequent runs
used current-run immutable page references. Initial indexing also found an
invalid paraphrased anchor and a parent summary refusing legitimate bottom-up
summary input. Those failures remain in the raw trial/ledger.

The full post-fix trial completed Flash, but four Standard imports selected
repeated margins that heading validation correctly refused. Supplying the same
margin-filtered original body to construction/subdivision resolved Chinese,
continuous-prose and 20-page cases in the targeted trial. `large-section` now
has valid construction but encountered provider truncation/overload during
summarization; these failures remain recorded. The
[final large trial](pageindex-large-final.json) again encountered gateway overload,
then completed one deliberately invoked public retry with the same operation and
immutable source, validated extraction reuse and duplicate-submission identity.
All five final navigation summaries were reviewed against their physical original
pages: 2026/2025 amounts, USD units, domestic scope, subsidiary exclusion and the
2025 audit qualifier remain distinct. This supplies the final Standard 12/15
coverage result without deleting failed attempts.
Standard long-navigation's gateway overload is retained alongside its successful
deliberate targeted new run. No automatic provider/algorithm fallback was added.

A Flash `no-toc` parent summary in the full trial falsely combined 2026 and 2025
facts on boundary physical p11. Its children correctly distinguished p10/p11.
Parent reduction now preserves child/fragment ranges and explicitly prohibits
inferring per-page facts from overlapping coverage. In the targeted real tree,
the parent identifies p11 as shared navigation coverage and says the summaries
do not establish that both sets of facts coexist there. Leaf original summaries
still identify p11 as 2025. QA reads p1/p11 and produces correct qualified claims.

Other model-written summaries remain navigation hints and may compress or omit
qualifications. No automatic semantic guarantee is inferred from schema/range
validation, and a generated summary cannot substitute for factual original reads.
The full reference report compares trees/extraction, not a Python QA score.
