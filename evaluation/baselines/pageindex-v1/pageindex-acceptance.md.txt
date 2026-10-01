# PageIndex replacement acceptance

Status: required local acceptance checks completed, 2026-10-01, under
[#47](https://github.com/L-1ngg/loreweave/issues/47).
The authority is [Spec #29](https://github.com/L-1ngg/loreweave/issues/29).
Local implementation is the preserved dirty working tree based on
`90eafdec9123802674cabcfa01afbc7ac3ec4796`; no commit, push, merge or deployment.

## Evidence and method

Per-module execution records are [#30](../development/issue-30.md) through
[#46](../development/issue-46.md). The final composed run uses the compiled
TanStack Start handler under Bun 1.3.12, real PostgreSQL 17, official MCP client
2.0.0, and Chromium on desktop 1440x900 and mobile 390x844. Controlled providers
establish protocol, authorization, concurrency, failure and lifecycle behavior.
Actual authorized gateway calls establish measured model behavior separately.

The frozen corpus consists of the [12-PDF manifest](../../tests/fixtures/pdf/manifest.json),
[two additional original sources](../../tests/fixtures/pdf/question-manifest.json),
the [20-page derivative](../../tests/fixtures/pdf/boundary-manifest.json) and
[11 fixed questions](../../tests/fixtures/questions.json). Rejected PDFs stay
in each mode's denominator of 15. SHA-256, generator transformations, source
facts and licenses are recorded. They are synthetic acceptance originals, not
a representative financial/legal/scientific benchmark or an upstream score.

## AC01–AC35 matrix

`Ran` describes the executed evidence for each required outcome. All 35 local
acceptance outcomes have evidence. `Not run / Why / Risk` records the remaining
verification boundary even for a passing product contract. The
[measured evaluation](pageindex-results.md) and
[original-evidence review](pageindex-semantic-review.md) are separate from
controlled protocol checks.

| AC | Ran and evidence | Not run | Why | Risk |
| --- | --- | --- | --- | --- |
| AC01 | Verified external archive/isolated restore, exclusive runtime/dependency/migration removal, active source scan, Bun entry; [P01](../development/issue-30.md), [recovery](../history/pageindex-retirement.md). | None required. | — | Old uncommitted data is in private recovery, outside current runtime. |
| AC02 | Public multipart acceptance, immutable exact bytes, duplicate submission/conflicting payload, same-name distinct document, refresh; `documents.spec.ts`, [P04](../development/issue-33.md). | Unbounded file sizes. | Upload is bounded. | Max upload is a product limit. |
| AC03 | Scanned/encrypted/malformed inputs and Flash structural refusal; no effective index on failure; both mode corpus runs. | Arbitrary damaged PDFs/OCR. | Text-layer input scope. | A readable but unsupported layout can still fail explicitly. |
| AC04 | Physical coverage, front matter, same-page boundary, original anchors/bookmarks, node identity reload, invalid range/anchor refusal; `trees.test.ts`, `standard.test.ts`, complete 30-input-pair tree/extraction comparison and targeted original-summary review. | Population-scale hierarchy correctness. | Fixed corpus only. | Model navigation can compress qualifications; facts require original reads. |
| AC05 | Library pagination/cursor, tree/status/retry UI, selected scope, real library-clear and ambiguous questions; `knowledge-scope.spec.ts`, `documents.spec.ts`. | Every document in an arbitrarily large library. | Discovery is bounded. | Metadata browsing is not exhaustive factual search. |
| AC06 | Activation transaction, failed update retaining old effective version, immutable historical Web/MCP originals, concurrent update guards; `updates.spec.ts`. | Automatic old-data migration. | Explicitly excluded. | Version/source retention consumes disk. |
| AC07 | Four shared in-process tools, long-document tree prerequisite, bounded tree/page windows; real short/long questions. | Every long-document research pattern. | Fixed questions. | Model policy plus service bounds do not guarantee exhaustive discovery. |
| AC08 | Single/multiple sources, currency/scope qualifiers, missing employee fact, unresolved 120/130 source conflict; all 24 selected real Web/MCP outcomes reviewed against immutable original evidence. | Broad domain correctness/blind independent scoring. | Synthetic corpus and implementation-agent review. | Flash follow-up scope wording has a disclosed caveat; no population accuracy claim. |
| AC09 | Current-run refs, forged/unread/wrong-run/scope/version/page refusal; missing PDF cannot validate and history degrades visibly; `references.spec.ts`. | Automatic semantic entailment proof. | Location validity and semantic support are separate. | Semantic support requires evaluation/inspection. |
| AC10 | Upload/mode/status/tree/scope/reading/stream/citation workflows, rendered original canvas and desktop/mobile screenshots; 23 browser scenarios. | Other browser engines. | Chromium desktop/mobile gate. | Safari/Firefox rendering is not established. |
| AC11 | PG canonical message/run snapshots, reload and saved completed history; actual SIGKILL/restart; persistence testkit 21 passes. | Every emitted token surviving process loss. | Durable snapshots are checkpoints. | Uncommitted output can be lost. |
| AC12 | UI Stop/SDK abort, stopped/no-final result and ownership release, stop/completion race, detach with zero viewers; `knowledge-lifetime.spec.ts`. | Remote model compute/billing termination guarantee. | Gateway exposes no such guarantee. | Stop aborts local dispatch/transport; remote billing can continue. |
| AC13 | Official Streamable HTTP client modern/legacy negotiation, all five tools and immutable page resources; `mcp.spec.ts`, `mcp-qa.spec.ts`. | Every external Agent UI. | Official client verifies the public protocol. | Third-party UI adaptation may differ. |
| AC14 | Independent bearer/Web capability gates, forged owner/scope, revocation including existing session, anonymous originals/history/attach refusal; Web/MCP composed tests. | Multi-user organization permissions. | Single owner only. | Credentials authorize the one owner's library. |
| AC15 | Actual indexing process kill/restart, explicit same-source retry, validated extraction reuse, no startup replay; `index-lifetime.spec.ts`. | Automatic execution resume. | Explicitly excluded. | User retries interrupted work and may incur new calls. |
| AC16 | Captured finite model/tool/page/context/output/time budgets, one-call exhaustion, invalid output/stage refusal, retained usage; [limits](../development/pageindex-limits.md). | Provider-independent USD caps. | Prices belong to the configured endpoint. | Defaults bound work, not provider price or remote termination. |
| AC17 | Frozen 15-input/11-question corpus, all Flash/Standard TS/Python pairs, rejected inputs retained, per-page extraction/ranges/summaries/reachability, 24 real answers with semantic support review, latency/calls/usage/cost and failed/cancelled/interrupted records; [results](pageindex-results.md). | Broad benchmark, Python QA score, exact per-question USD. | Fixed corpus; comparator tests indexing/original reachability; unit prices absent. | Selected explicit reruns are disclosed; upstream scores are not used. |
| AC18 | Frozen install, setup/new PG/config, Bun dev/build/compiled serving, typecheck, format/docs, unit/browser/SDK/bundle gates, current docs. | Hosted CI/production deployment. | No push; deployment deferred. | Local CI-equivalent checks do not establish hosted-run success. |
| AC19 | Default Flash and explicit Standard, independent no-TOC/TOC construction, explicit Flash failure→Standard retry retaining identity; `standard.spec.ts`, `index-lifetime.spec.ts`. | Automatic switch. | Product excludes it. | Model construction can fail and requires explicit retry. |
| AC20 | Both default summaries, Flash merge/subdivide, Standard subdivision, typed output/ranges; real boundary defect corrected and targeted `no-toc`/large-summary original review passed. | General semantic summary guarantee. | Generative navigation hints. | Summaries can omit qualifications; original reads remain mandatory. |
| AC21 | Acceptance before background work, close/reopen, actual restart and explicit retry, prior version preservation; `index-lifetime.spec.ts`, `updates.spec.ts`. | Worker replay after restart. | Explicitly excluded. | Interrupted work remains interrupted until retry. |
| AC22 | Nonempty selection enforced per metadata/tree/page/ref, invalid empty/forged selection, library discovery/clarification; real library and selected questions. | Exhaustive arbitrary-library absence. | Bounded reading. | An evidence gap describes inspected evidence. |
| AC23 | Mixed 20/21 selected read asserts tree only required for >20, additional reads and bounds; `knowledge-scope.spec.ts` and real mixed question passed in both modes. | Policy compliance of every model. | Selected endpoint measured. | Tools enforce the long-document prerequisite; models choose relevant reads. |
| AC24 | Claim-adjacent Markdown physical-page refs, multi-source refs, original canvas/text, mobile return/position, history after update/retirement; `knowledge.spec.ts`, `updates.spec.ts`, `retirement.spec.ts`. | Paragraph highlighting. | Excluded scope. | Page-level precision only. |
| AC25 | Official client's primitive reads without QA calls and independent question_answer with no Web thread; real independent MCP answer in each mode. | External client model reasoning. | Client controls its model. | Only LoreWeave server-side questions are measured. |
| AC26 | Canonical follow-up history, scoped rereads/current-run refs, poisoned prior-answer fixture, real previous-year question; `knowledge-scope.spec.ts`. | Arbitrary conversation intent accuracy. | Fixed follow-up. | Every new document fact still requires current original evidence. |
| AC27 | Same run across reader cancellation/reload/navigation/last-viewer close, duplicate acceptance and zero extra calls; actual SIGKILL interrupted/zero replay and auth checks in controlled and both-mode real lifecycle runs. | Distributed failover. | Single local process. | Checkpoint durability; in-process replay log is lost on restart. |
| AC28 | Server-held AES-GCM revision keys, independent roles, captured old/new request routing and nonsecret SSR/settings, role verification; `settings.spec.ts`. | Every provider/model pair. | Capability verification is connection-specific. | New connections must pass actual required workflows. |
| AC29 | Maintained TanStack OpenAI Chat Completions adapter, official default URL/controlled wire paths; actual authorized compatible gateway tools/stream/schema/index/QA. | Separate direct api.openai.com paid run. | User supplied a compatible gateway, not a direct OpenAI credential. | Compatibility findings apply to this endpoint/Model ID; model branding is provider-declared. |
| AC30 | Same-name independent upload, explicit target update, stale revision/latest-operation refusal, immutable history; `updates.spec.ts`. | Filename overwrite. | Product excludes it. | Old versions retain storage. |
| AC31 | Retirement/current discovery and follow-up refusal, retained authorized originals, revoked historical resources, pending update cannot resurrect, real process restart; `retirement.spec.ts`. | Permanent purge. | Excluded scope. | Retired bytes intentionally remain. |
| AC32 | Exactly one PG owner, server-verified capability, no registration/org/user-selected owner; Web and MCP tests. | Multi-user sharing. | Excluded scope. | Single instance owner. |
| AC33 | Config password reset/session revision, one-time MCP plaintext, independent revoke/Web remains, stored hashes across actual restart; `access.spec.ts`, `mcp.spec.ts`. | Email recovery. | Excluded scope. | Recovery/reset uses private runtime configuration. |
| AC34 | Three protected Router views/default conversation/deep links, Query hydration/clear on logout, desktop adjacent original/mobile return, background identities; browser screenshots plus Bun dev smoke. | Other browser engines. | Chromium gate. | Original canvas and exact position measured on these two viewport sizes. |
| AC35 | Stable CRUD/history/rename, active deletion rejection and acceptance/delete race, Stop→delete, isolated conversation deletion, failed/interrupted manual resend retains old outcome; `conversations.spec.ts`. | Editing/branches/completed regeneration. | Excluded scope. | A deliberate resend creates new billable work. |

## Verification record

- Ran: 7 Bun tests / 55 assertions; 23 public HTTP/official MCP/desktop-mobile
  Playwright scenarios; PG persistence conformance 21 passed / 7 optional skips;
  build/typecheck/format, baseline SSR/Query/Form/PG/upload/GET/HEAD/Range/SSE/MCP,
  zero-observer replay, SDK cancellation and server-only bundle checks.
- Optional persistence skips: interrupts, generic metadata store, generation
  runs, artifacts/blobs and reclaim/parent-run listing are outside this app's
  implemented MessageStore/RunStore surface. Message metadata and thread-run
  state checks are enabled; these skips do not bypass required chat persistence.
- Not run: hosted CI, non-Chromium engines, a separate direct OpenAI account,
  broad real-world quality benchmark and remote compute/billing termination.
  These boundaries do not stand in for required real gateway quality evidence.
- Real evaluation: all 30 corresponding input/mode pairs, selected Flash 11/15
  and Standard 12/15 ready, Python 10/15 per mode, 22 Web and two independent MCP
  outcomes reviewed; failed inputs/earlier attempts stay in reports. Provider
  key-reported cumulative actual cost $0.199568112 USD; unavailable usage and
  different provider/dispatch counters are disclosed, not inferred as zero.
- Local service: `http://127.0.0.1:41737/`, configured real index/QA roles,
  desktop/mobile login/Query hydration/navigation/logout and no plaintext key;
  [evidence](../development/pageindex-local-service.json). Existing 5173 remains.
