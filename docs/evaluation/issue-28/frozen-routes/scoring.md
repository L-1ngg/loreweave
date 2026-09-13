# Frozen route experiment: independent agent development scoring

The experiment stopped after 17 of 96 planned case/profile combinations produced terminal records. Four delivered answers; thirteen did not. Eight unresolved HTTP requests consumed all admission permits. The remaining 79 combinations have no completed evaluation result and are not failed model answers. One interrupted, still-queued interactive request is outside the 17 completed records. The experiment did not reach a comparison of four usable routes.

This is **independent agent development scoring**, not human review or formal issue #18 acceptance. The scoring agent read the frozen dataset requirements, delivered text, cited originals, maintenance snapshot, and transport state without calling the model or database. It did not generate these answers. No final aggregate semantic pass/fail count is assigned: nondelivery cannot be scored as answer semantics, and the incomplete, ordered sample cannot represent the planned experiment.

## Evidence and version boundary

The scored [report.partial.json](report.partial.json) has SHA256 **`3c049e74c56e5fc55bddabc108bc470c3711ccf2d19a3449de97e0996ce3f3dd`**, verified from its bytes. It contains exactly 17 completed records, all profile `source`. The frozen [dataset](dataset.json) identifies `issue-25-agent-reviewed-v1`; expectations were reviewed earlier and are not newly inferred from these outputs.

[stopped.json](stopped.json), [transport-at-stop.json](transport-at-stop.json), and [maintenance.json](maintenance.json) provide the stop and readiness evidence. The report's inline maintenance field says unavailable; the separate maintenance artifact supplies the actual snapshot. [execution.json](execution.json) records a real-provider development run with `qualityAcceptance: false`.

Per the stop record, the running process predates the final Wiki fallback/readiness, graph query ordering, and Host failure-classification fixes. These artifacts cannot verify those later changes. Final software checks are separate evidence; their results cannot retroactively turn this run into a successful model-quality or route experiment.

## Delivered-answer assessment

Scores: **2** meets the evaluated requirement, **1** has a material limitation, **0** misses it. Citation support assesses whether original text entails the answer, not merely whether a handle resolves. `N/A` means no relevant conflict was present. These are case-level development judgments, not a formal semantic gate.

| Case | Correctness | Completeness | Citation semantic support | Conflict handling | Assessment |
| --- | ---: | ---: | ---: | ---: | --- |
| headless | 2 | 2 | 2 | N/A | Correctly gives permission deny/20, question cancel/22, oauth cancel/24. `e12` contains the protocol table; `e13` explicitly states the defaults and existing 1/2 meanings. The additional cancel_confirm/21 and plan_approval/23 details are supported. |
| dangerous | 2 | 2 | 2 | N/A | Correctly says git push does not honor a remembered always-allow prefix and still prompts. `e13` directly supports the dangerous-operation exception and object-scoped authorization; `e16` supports tool plus argsPattern. The answer's extra details remain within the source. |
| isolation | 1 | 2 | 0 | N/A | Correct central point: ordinary same-process Agent instances do not establish process fault isolation or a security sandbox. It instead selects general knowledge, labels no retrieval, and provides no project references; the frozen test expects project evidence. Its “必须使用独立的 OS 进程、容器或虚拟机” conclusion overgeneralizes sandbox requirements, particularly after itself mentioning WASM. The question is phrased generically, so basis selection has a dataset/prompt ambiguity; this is not a JSON-format error. |
| reference | 2 | 2 | 2 | 2 | Correctly identifies ADR-007's retirement of compiling/running grok-build as a CI/check prerequisite, adoption of in-repo FrameDump golden, and rejection of runtime cell equivalence as an exit condition. `e13` supports cost, `e14` the historical ADR-006 condition, and `e16` its replacement; `e1` supports the date. It distinguishes the superseded rule from the current rule instead of combining them. |

The four outputs include three answers with source citations and one explicitly uncited general answer. The automatic report leaves three `pending_agent` and flags isolation as `invalid_or_missing_citations`; this document adds semantic inspection without rewriting that immutable report. Isolation remains a delivered answer even though the evaluation rejects its evidence basis. Conversely, a technical timeout on a missing-evidence question does not count as a correct refusal.

## All completed records and failure classification

`ND` means no delivered answer exists, so correctness, citation entailment, and conflict handling cannot be assessed. Elapsed time is measured end to end, including queueing. The historical Host used `timed_out / budget_exhausted` for several distinct causes; transport evidence separates them.

| Case | Elapsed ms | Delivery / semantic assessability | Observed cause or boundary |
| --- | ---: | --- | --- |
| request-shape | 18,533.564 | ND | Four exploration calls and two retrievals; all six HTTP requests settled 200. Retrieval-budget diagnostics and sub-30-second completion support call-cap exhaustion, not a wall-clock timeout. |
| headless | 15,648.134 | Delivered; assessed above | Three dispatched HTTP requests, all settled 200. |
| permission | 30,032.681 | ND | Four dispatched HTTP requests; final request is `uncertain / stream_interrupted`. This reached the ordinary wall-clock deadline during provider activity; it is not merely the call-cap case. |
| dangerous | 18,445.223 | Delivered; assessed above | Three dispatched HTTP requests, all settled 200. |
| isolation | 13,579.164 | Delivered; assessed above | One HTTP request, zero retrievals; failed evaluation evidence requirement. |
| reference | 26,000.914 | Delivered; assessed above | Three dispatched HTTP requests, all settled 200. |
| team | 30,028.772 | ND | Six dispatched HTTP requests; final request `uncertain / transport_uncertain`, with retrieval-budget diagnostics also present. Wall-clock expiry and provider uncertainty prevent reducing this to a pure call-cap explanation. |
| release | 30,005.051 | ND | Request expired without dispatch after queueing. |
| draft-release | 30,027.324 | ND | Request expired with `queue_deadline`, without dispatch. |
| clear | 30,022.838 | ND | Request expired without dispatch after queueing. |
| session-path | 30,017.559 | ND | Request expired without dispatch after queueing. |
| storage | 30,026.974 | ND | Request expired without dispatch after queueing. |
| manual-compact | 30,015.815 | ND | Request expired without dispatch after queueing. |
| markdown | 30,023.272 | ND | Request expired without dispatch after queueing. |
| sla-missing | 30,015.438 | ND | Request expired with `queue_deadline`, without dispatch; no model refusal to assess. |
| revenue-missing | 30,031.225 | ND | Request expired without dispatch after queueing; no model refusal to assess. |
| core-evolution | 60,032.055 | ND | Complex-case 60-second queue deadline, without dispatch. |

There is no `invalid_draft` among these 17 frozen records. The evidence does not support attributing their failures to JSON quote escaping. The ten queue-only records have an exploration count of one despite zero dispatched HTTP requests: logical counters must not be mistaken for actual provider executions.

## Metrics and their limits

- Completed records: **17/96**; delivered **4/17 (23.5%)**; nondelivery **13/17**. These describe the observed prefix, not full-dataset quality.
- Not completed: **79/96**, including the interrupted queued request. No answer failure, semantic score, or measured terminal latency is imputed to these combinations.
- Nearest-rank p95 over all 17 completed records: sorted observation `ceil(0.95 × 17) = 17`, **60,032.055 ms**. This includes nondelivery and is not a successful-answer-only estimate.
- Ten of the 17 completed records expired before HTTP dispatch: nine ordinary cases near 30 seconds and one complex case near 60 seconds. Their latencies are dominated by the blocked admission queue.
- The 17 completed runs account for **26 dispatched HTTP requests**, using operation/parent-operation IDs in transport evidence. The full stop snapshot contains **68 dispatched requests** including source preparation and maintenance: 60 settled/http200 and eight uncertain. It also contains 11 expired, undispatched records and one queued, undispatched record.
- Provider tokens and monetary cost are unavailable; logical request counts do not provide billing evidence.

The observed prefix is selected by execution order and early stopping. Delivered-only semantic observations are subject to survival bias, while the all-completed p95 is heavily contaminated by exhausted admission capacity. No Wiki, graph, or combined-profile completed sample exists. Neither this latency statistic nor the four delivered answers supports a production SLA, complete route comparison, or aggregate semantic acceptance claim.

## Readiness, uncertainty, and stop rationale

All **20 source documents are searchable**. At maintenance capture, both Wiki and graph have **16 pending and four failed, with zero ready**. Identity revalidation succeeded for all 20. Wiki failures comprise three `provider_uncertain` and one `needs_attention:source_coverage`; graph failures comprise three `provider_uncertain` and one operation timeout. The configured maintenance budget was 300 seconds; actual worker elapsed times were about 338.842 seconds for Wiki and 400.487 seconds for graph, because the recorded operator budget excludes settling the current bounded operation.

At stop, the eight uncertain permits comprise **six background and two interactive** requests: seven `transport_uncertain` and one `stream_interrupted`. All were dispatched, have no settlement timestamp, and have null provider request IDs in the snapshot. The two interactive uncertainties belong to permission and team. Subsequent requests could not acquire capacity and expired before dispatch. Continuing the same blocked experiment would add queue expirations without testing model answers.

The stop record states that no permit was reconciled or deleted and that the database was retained. This preserves the authority record: local timeout, abort, or elapsed time does not establish that remote provider work ended. Releasing the permits requires actual completion/termination evidence followed by explicit `model:status` reconciliation. This scoring task did not perform recovery or independently contact the provider. The data establishes uncertainty, not that all eight provider operations were definitely still executing.

Because there are no ready derived indexes, this experiment cannot measure Wiki/graph semantic contribution. It provides concrete development evidence of admission availability limits, incomplete maintenance, several direct-answer successes, and a general-versus-project evidence-basis mismatch. Formal issue #18 human acceptance and a completed route comparison remain outstanding.
