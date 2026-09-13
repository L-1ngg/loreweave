# SiliconFlow synchronous request settlement

Inspected: 2026-09-13, 13:53 UTC. Scope: official public SiliconFlow
documentation for `https://api.siliconflow.cn/v1`, particularly
`deepseek-ai/DeepSeek-V4-Flash`. This investigation made no model requests,
used no credentials, and changed no provider state. It does not independently
verify the contents of the application's eight historical `uncertain` rows.

## Findings

The public synchronous Chat Completions contract does **not establish a way to
recover the terminal state of the eight disconnected historical requests**.
It documents a server trace identifier and a normal streaming completion
signal, but the inspected documentation does not promise cancellation on
disconnect, a maximum server execution time, or a synchronous request
status/cancellation endpoint. Missing documentation is an evidence limit,
not proof that the provider has no internal capability. [S1–S5]

| Question | Official statement or current observation | What it supports |
| --- | --- | --- |
| Does client timeout or disconnect terminate server generation? | No such guarantee found in the inspected synchronous API, streaming, reasoning, or troubleshooting documentation. The FAQ instead recommends longer client timeouts and streaming for long outputs. [S1–S5] | A local timeout or aborted socket is not documented terminal evidence. |
| What identifies the request at the provider? | The response header is `x-siliconcloud-trace-id`. It is server-generated, globally unique, and intended to help backend developers locate request-chain logs. [S1, S6] | Persist this header as soon as response headers arrive. A local UUID is not a substitute. |
| How does a successful stream end? | The API says SSE streaming “通常以 data: [DONE] 结束”; official client examples read the streaming response. [S1, S2] | Preserve the connection and read the complete provider response. A client stopping consumption is not the same event. |
| Is synchronous completion lookup or cancellation documented? | The public API catalogue exposes `POST /chat/completions`; its documented lookup/cancel operations belong to batch jobs or video jobs. No synchronous chat lookup/cancel API was found. [S1, S7, S8] | Do not invent an OpenAI-compatible `GET` or cancel endpoint, or apply a batch endpoint to an ordinary chat request. |
| Can the console prove completion by time/model without an ID? | The public docs describe providing the trace ID to backend developers, but do not document a customer-visible query proving an individual synchronous request has terminated. An unauthenticated visit to the console redirected to account login. [S6, S9] | This read-only public investigation cannot certify console capabilities or match old requests. A time/model match alone may be ambiguous. |
| Is there a documented maximum remote execution time? | None was found in the inspected sources. Troubleshooting mentions 503/504 and client timeouts without publishing a maximum inference lifetime. [S3, S5, S6] | Waiting a guessed duration cannot be presented as provider-confirmed completion. |

## DeepSeek-V4-Flash reasoning controls

The model-specific part of the current Chat Completions schema explicitly
names `deepseek-ai/DeepSeek-V4-Flash` for `reasoning_effort`. In reasoning
mode, normal requests default to `high`; certain complex agent requests may
be set to `max`. The allowed values are `high` and `max`. For compatibility,
`low` and `medium` map to `high`, while `xhigh` maps to `max`. Therefore
`reasoning_effort: "low"` is **not** a documented way to reduce this model's
reasoning below `high`. [S1]

`enable_thinking` is documented as a boolean switch between reasoning and
non-reasoning modes and as applicable to “most reasoning models.” The
inspected schema does not name V4-Flash specifically for this field or state
the field's default. `enable_thinking: false` is the documented general
switch to try, but this investigation cannot elevate that general wording
to a verified V4-Flash guarantee. A controlled request should inspect the
actual response's `reasoning_content` and available reasoning-token usage,
including the possibility of model-specific parameter rejection. [S1, S4]

`max_tokens` limits final-answer tokens and explicitly excludes thinking
tokens. `thinking_budget` is documented separately. The reasoning guide says
Qwen3 forcibly stops thinking at that budget, but other reasoning models
may continue. Consequently neither a small `max_tokens` nor an assumed
hard `thinking_budget` establishes a V4-Flash wall-clock timeout or proves
that an already disconnected request has stopped. [S1, S4]

For long non-streaming outputs, the official troubleshooting recommendation
is to use streaming and increase client timeout. A UI answer deadline can
still be short: the application can stop delivering the answer while its
transport owner keeps consuming the already dispatched response. The
separation between those lifetimes is an application design inference;
SiliconFlow does not promise a special drain/reconciliation service. [S3, S5]

## Constraint on strict concurrency and recovery

Assume a request was dispatched and its connection then disappeared. Two
remote situations can produce the same local observation:

1. The provider finished, but the application never received the terminal
   response.
2. The provider is still executing.

Without terminal evidence, a documented maximum lifetime, or a provider
query/cancellation acknowledgement, the application cannot distinguish those
situations. Releasing the slot eventually restores availability in situation
1, but could exceed a strict bound on remote executions in situation 2.
Keeping the slot preserves that bound but can block indefinitely. A local
lease, database restart, elapsed-time heuristic, or API-key rotation does
not resolve the missing observation. This is a consequence of the stated
contract, not a claim about SiliconFlow's actual unseen execution duration.

Keeping a healthy response connection alive and draining it after the
interactive deadline avoids creating that ambiguity unnecessarily. It does
not solve a genuine network failure, process loss, or the historical requests
whose sockets have already been closed.

For those historical requests, acceptable new evidence would be a provider
record or explicit provider confirmation that uniquely identifies the
affected requests and establishes completion/termination. The trace-ID
documentation supports using that ID when available; it does not promise
that support can recover requests from only local timestamps and model names.
No such confirmation was obtained during this investigation. [S6]

A future operational policy could deliberately allow bounded uncertainty,
but it would change the meaning of the concurrency guarantee. Such a release
must remain distinguishable from a proven provider completion; the current
research does not authorize or perform it.

## Sources and coverage

All sources below were accessed on 2026-09-13. The API and documentation pages
were fetched as public HTML. The API catalogue, streaming and reasoning
guides, text-generation guide, model-error FAQ, API-error FAQ, rate-limit
guide, account FAQ, release notes, and batch detail/cancel pages were checked.
No undocumented authenticated endpoints were probed. The console observation
was unauthenticated; no logged-in UI was available to this investigation.

- **S1 — Create chat completion:**
  <https://docs.siliconflow.cn/docs/api/chat-completions-post>.
  Owns `stream`, `enable_thinking`, `reasoning_effort`, `thinking_budget`,
  `max_tokens`, and the trace-response-header contract.
- **S2 — Streaming output:**
  <https://docs.siliconflow.cn/docs/userguide/capabilities/stream-mode>.
  Official Python and HTTP streaming examples, including `[DONE]` handling.
- **S3 — Model troubleshooting:**
  <https://docs.siliconflow.cn/docs/userguide/faqs/misc>.
  Section 6 recommends streaming and longer client timeout for truncated
  long outputs; it gives no fixed server execution lifetime.
- **S4 — Reasoning models:**
  <https://docs.siliconflow.cn/docs/userguide/capabilities/reasoning>.
  Separates thinking/final-answer limits, documents `reasoning_content`, and
  qualifies the enforcement of `thinking_budget` for models other than Qwen3.
- **S5 — API error troubleshooting:**
  <https://docs.siliconflow.cn/docs/userguide/faqs/error-code>.
  Describes 503/504 and recommends streaming; no disconnect cancellation or
  maximum inference duration is promised there.
- **S6 — Text generation:**
  <https://docs.siliconflow.cn/docs/userguide/capabilities/text-generation>.
  Section `x-siliconcloud-trace-id` describes the header's origin and its
  use by backend developers to locate logs.
- **S7 — Get batch details:**
  <https://docs.siliconflow.cn/docs/api/batches-%7Bbatch_id%7D-get>.
  `GET /batches/{batch_id}` requires a batch ID and exposes batch lifecycle
  timestamps, not synchronous chat-request status.
- **S8 — Cancel batch:**
  <https://docs.siliconflow.cn/docs/api/batches-%7Bbatch_id%7D-cancel-post>.
  `POST /batches/{batch_id}/cancel` applies to a batch task; the response
  includes separate `cancelling_at` and `cancelled_at` fields.
- **S9 — Public console entry:** <https://cloud.siliconflow.cn/>.
  Both the entry and an unauthenticated `/account/usage` visit redirected to
  `account.siliconflow.cn` login. This is an access observation, not a
  verified console feature inventory.
