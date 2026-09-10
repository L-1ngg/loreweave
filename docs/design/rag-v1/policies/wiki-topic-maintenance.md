# Wiki topic selection and maintenance policy

Status: implementation defaults selected on 2026-09-10 under Q36 and the user's
request to specify candidate retrieval, inspection limits and topic creation.
This is part of M05's contract, not implemented behavior or measured tuning.
M05 keeps this policy behind its existing maintenance interface. M02 supplies
original passages and current versions, M03 identity, and M08 durable execution.

## P01: Two work streams and complete source coverage

Each source activation/correction starts two independently checkpointed streams.

1. Mandatory revalidation: reverse-query page dependency records for changed
   source or identity revisions. Enumerate every affected page, including pages
   supported only by removed passages. Read stable page-ID batches of 20 with a
   durable cursor; deduplicate/coalesce by page and required revision set. A
   batch limit controls work per claim, never total affected-page coverage.
   A shared-source change enumerates dependent project pages throughout the
   trusted organization; discovery's same-project ranking filter must not cut
   this dependency fan-out. Preserve each affected page's own applicability.
2. Topic discovery: inspect all passages of the newly active source, even when
   no existing page depends on them. Use Markdown heading paths and existing
   passage boundaries to pack at most 4,000 source tokens per packet, including
   repeated heading/context tokens. Split oversized prose/code/table structures
   using their recorded locators and necessary headers; retain continuation
   markers when full meaning spans packets. No semantic-diff prerequisite or
   first-N-chunks shortcut is assumed. Old-source removal is covered by stream 1.

For each packet, propose at most four topic descriptors, each containing subject
identity or unresolved mention, a reader question/aspect, applicability scope,
supported claim references, and proposed inclusion/exclusion boundaries. A
validated coverage ledger accounts for every input passage as assigned, explicit
non-topic context, or unresolved/continuation. Overflow topics retain passage
locators for another bounded subtask; assigning a passage to a broad catch-all
is not evidence of complete topical coverage. An unresolved packet remains
visible; page quotas never turn dropped input into successful processing.

Descriptors are proposals, not factual evidence. References must resolve to the
current source, and semantic review checks actual support. A single source can
support a useful page; one page per file, heading or entity is not required.
Group equivalent proposals within the operation before page generation. Combine
changes for the same page so mandatory and discovery work do not independently
publish competing replacements. Workers revisit current dependencies on conflict.

Source-version invalidation still follows C02 immediately. Mandatory revalidation
and topic discovery have separate progress records; source-searchable does not
imply Wiki-ready. Scope/identity corrections trigger the same streams for the
affected material. Retained factual notes are sources; editing preferences are
routing guidance and never become factual claims.

## P02: Page catalogue and candidate retrieval

Maintain a topic catalogue transactionally with each page publication. A compact
card contains page ID/version, canonical title/aliases, subject identities,
reader question, inclusion/exclusion boundaries, applicability scope, selected
heading labels, dependency status, and a bounded synopsis. Render at most 160
tokens per card, retaining IDs/scope outside the free-text allowance; record
omitted sections. Long boundaries can be inspected in detail rather than silently
changing their meaning. The full descriptor remains stored and versioned.

The catalogue is a routing index. It includes pages pending source refresh and
retired topic descriptors, so staleness or retirement cannot masquerade as topic
absence. Old prose is never admitted as
current answer evidence because its card was retrieved. Resolve merged aliases
to current canonical pages; split entries lead to their successor descriptors.

Filter by trusted organization and applicability before ranking. Project inputs
can find same-project pages and relevant shared pages. Updating an independently
shared rule requires support for shared applicability and the actor's grant;
project-only facts cannot broaden a shared page. Other projects are not eligible
merge/update targets simply because their topic names match. Unresolved entity
mentions may retrieve lexical candidates but do not create identity equivalence.

For each proposed topic, independently retrieve at most 20 cards on each route:

| Route | Indexed signal and rank |
| --- | --- |
| Title/alias | Exact normalized title/alias first, then lexical title match |
| Entity | Confirmed canonical subject IDs, ranked by matched subjects and aspect text |
| Lexical | Title, question, boundaries and headings using PostgreSQL full-text search |
| Vector | The same topic descriptor text using pgvector and the pinned embedding profile |

Normalize titles with Unicode NFKC, case folding and whitespace normalization;
do not remove meaningful versions, numbers or technical punctuation. Fuse route
ranks using equal-weight RRF, `score = sum(1 / (60 + rank))`, deduplicate by
canonical page ID, and keep the best 40 cards; break ties by stable page ID.
Ranks start at one; an absent route contributes zero for that page.
Record per-route ranks, exclusions, unavailable indexes and truncation. RRF is a
ranking rule, never a probability that two topics are identical.

A resolved explicit user target is protected from ranking truncation. Existing
page assignments and affected dependencies route to stream 1 rather than having
to win this Top-K search. Oversized explicit target sets use continuation work.

## P03: Inspection limits and decision procedure

Inspect the top eight cards first. If there is no compatible existing page, the
boundary is ambiguous, or creation is proposed, inspect the next eight from the
same ranked pool: at most 16 distinct cards per topic decision, or all available
cards if fewer exist. Stop early for a supported unambiguous reuse decision.

Across both passes, inspect at most three distinct candidate pages in detail.
The initial inspection contains at most 6,000 tokens of page text and current
original support. Source packet plus card/detail context fits a 16,000-token
planner input budget, including prompts, with at most 2,000 output tokens.
Trim optional candidates before required meaning. If required content exceeds
one inspection, P07 permits bounded continuation over the same selected pages;
it does not authorize selecting a fourth page or extending the 16-card set.

For each inspected candidate, emit a structured decision with page/version,
source references, subject compatibility, aspect compatibility, applicability,
fit within inclusion/exclusion boundaries, added/revised/conflicting claims,
and an explicit reason. Prefer these observable checks over a model's numeric
confidence score or an uncalibrated cosine threshold.

| Decision | Required justification and effect |
| --- | --- |
| Update/revalidate existing | Same supported subject, reader question and compatible scope; the material fits that page's topic. A changed claim or conflict normally updates this page, not a competing new page. |
| Link existing | The information belongs to an existing shared/related page; link it from the relevant project/topic entry without copying it into a duplicate page. |
| No content change | Current eligible evidence already covers the contribution, or it adds no independent supported knowledge. Revalidation may still have to publish a current dependency manifest. |
| Create topic | All creation gates in P04 pass. |
| Defer | Target/identity/applicability is unresolved, required coverage is unavailable, or the bounded inspection cannot justify a decision. Preserve a reason and retry trigger. |

If several pages pass the same-topic/scope test, choose the existing retained
assignment when valid, otherwise the earliest-created canonical page (page ID
breaks ties). Queue a merge proposal listing duplicate pages; do not make a third
page. If candidates represent materially different meanings and sources cannot
disambiguate them, defer or ask a focused question for an interactive request.

## P04: Creation gates and restructuring

A new page requires all of the following:

- A concrete reader question and independently useful subject/aspect boundary.
  No minimum document count or arbitrary word count is required. A short,
  supported operational rule can qualify; a bare name or unsupported outline
  cannot. Adding a section to a compatible page takes precedence.
- At least one substantive source-supported claim, with its necessary context
  and applicability. The title, entity name and generated synopsis alone are
  insufficient. A displayed, supported conflict can be useful knowledge.
- No compatible reuse/link target among the inspected candidates after the
  expansion pass (or exhaustion of a smaller candidate set).
- A final exact normalized-title/alias and subject-plus-aspect-key lookup in the
  eligible catalogue, including pending/retired pages and creation reservations.
  Inspect colliding descriptors within the same 16-card/three-detail-page budget;
  if new collisions exceed it, defer. A collision blocks blind creation but does
  not by itself prove equivalence. Normalized keys catch literal equivalents;
  they do not solve all paraphrases or identity ambiguity.
  Recognize the current operation's own reservation as its existing intent;
  only competing reservations require ownership/outcome resolution.
- Required search routes are ready for the eligible catalogue snapshot. An empty
  catalogue can bootstrap directly. Missing entity IDs are allowed when not
  required for the topic, but unresolved identity that determines its boundary
  blocks creation. Unavailable/stale vector coverage permits justified updates
  from other routes; it defers novelty decisions until indexing recovers.

Bounded retrieval cannot prove global absence of a synonymous page. Record the
40-card pool, inspected subset and exclusions for later diagnosis; measure false
creation and missed reuse on representative topics. Do not claim zero duplicates.

Automatic merge/split follows Q30 in the separate restructuring operation owned
by #11. A merge requires the same subject/aspect/scope plus overlapping supported
claims; a split requires separately useful reader questions and an explicit
claim-to-successor map. Similar titles, conflicting facts or page length alone
are not triggers. Retain existing entries and user corrections. Repeatedly
proposing the same rejected/reversed structure with unchanged inputs is a no-op;
new evidence, explicit user guidance or a versioned policy change can reconsider.
The initial #9 slice records restructuring proposals; #11 executes them.

## P05: Publication, concurrency and bounded work

Maintain a monotonic catalogue revision per organization/project-or-shared scope.
Creating, merging, splitting or changing a topic boundary/title/alias increments
it in the publication transaction. A plan records the relevant catalogue
revisions, proposed-topic reservation, source/identity versions and page versions.
New-topic reservations are idempotent by maintenance operation and descriptor;
unique normalized scope/subject/aspect keys detect literal concurrent collisions.
Unresolved subjects include their source mention identity, not name equality.

Before create/merge/split publication, validate expected catalogue revisions
alongside C07's page/source/identity and worker-fence checks. Publish catalogue
records, aliases, page pointers and required lexical fields atomically. Claim a
matching reservation or inspect its owner/outcome; uncertain ownership blocks a
second creation. Successful creation changes the catalogue revision, so a plan
based on the older catalogue must retrieve again before it can publish. This
limits concurrent duplicate creation without serializing all source activation.
Release/reassign a failed reservation only after durable outcome inspection
establishes whether publication committed; lease expiry alone is insufficient.
Vector projection may finish later; keep its readiness distinct from publication.

On a revision conflict, reuse the same durable logical operation and rerun the
necessary retrieval/decision only within its remaining budget. Do not silently
retry a stale create instruction. Mark obsolete source work superseded; retry a
current topic when a blocking reservation/indexing task settles. Record wake-up
conditions and bounded attempts; no immediate unbounded self-rescheduling.

| Work unit | Initial limit |
| --- | --- |
| Dependency enumeration | 20 pages per durable cursor batch; process all batches |
| Source proposal extraction | 4,000 source tokens and up to four descriptors per packet; every passage accounted for |
| Extraction calls | One extraction plus at most one repair/provider retry per packet |
| Topic planning calls | At most three actual model requests total, including expansion, format repair, provider retry and conflict replanning |
| Planning/extraction execution | Each subtask has a 120-second execution deadline from claim, a maximum 45-second model-request timeout, and persisted admission counters |
| Page generation/review | Per bounded draft block, at most three generation and three review requests under V02; 120 seconds from first claim and 45 seconds per request; counts/deadline survive worker restarts |

Initial waiting for a worker is reported separately; after first claim, retries
and continuation queue waits count toward the applicable deadline. These are not an
end-to-end Wiki-refresh SLA or the interactive C05 budget. Share M08's background
model slot, preserving interactive admission priority. Resume the same execution
budget after interruption, or terminate it with a visible reason. A new source
revision or explicit repair is a new attributable trigger, not an automatic budget
reset. Persisted discovery continuations must reduce remaining passage/topic
coverage; card/distinct-page limits never reset. P07 defines the separate,
finite continuation allowance for detail windows and source-proposal overflow.

Defer is a planner result, not an extra global operation state. Map transient
index/reservation waits to M08 retry_wait, and exhausted/unsupported decisions to
failed with an actionable reason. Aggregate maintenance stays pending/failed
while required work is unresolved; it cannot report Wiki-ready by dropping
mandatory pages or discovery leftovers. Original-source retrieval remains usable.

## P06: Verification and delivery ownership

Verify behavior at M05's maintenance/read interface with scripted model outputs
and real PostgreSQL publication/lease races. Check these cases explicitly:

| Scenario | Required observable result | GitHub work item |
| --- | --- | --- |
| Same topic expressed with another title; one-source useful new topic; bare entity mention | Reuse, justified creation, and no invented page respectively | #9 |
| Project A/B same title and shared guidance | Distinct project pages and shared linking without scope widening | #9 |
| Match at card 9; 40-card pool; necessary detail exceeds three pages | Expansion within limits; unresolved inspection deferred with diagnostics | #9 |
| Empty catalogue versus missing vector projection or stale page | Bootstrap allowed only for empty catalogue; incomplete search defers creation; stale cards remain discoverable | #9 |
| New section with no old dependents; removed old section; 45 dependent pages | Discovery processes new topic; old claims revalidate; all 20/20/5 affected-page batches run | #10 |
| Long packet or more than four topics; unchanged semantic content at a new source version | Coverage continuation without lost passages; current dependency manifests without duplicate pages | #10 |
| Contradictory fact and similar titles | Existing page presents conflict; no title-only merge or length-only split | #10, #11 |
| Two concurrent equivalent creates, expired reservation owner, worker restart | One literal topic outcome; inspect uncertain effects; counters/cursors survive and stale plans cannot publish | #9, #16 |
| Merge/split followed by new import or user reversal | Resolve aliases/successors, preserve intent, suppress unchanged restructuring loops | #11 |

Use a small versioned development fixture set with expected routing actions,
source references and allowable equivalent page targets. Report candidate
recall@8/@16, false creation, missed reuse, deferred-decision reasons, mandatory
coverage, calls/tokens and maintenance duration. Scripted tests prove control
behavior, not model routing quality. Evaluate model decisions against human-
reviewed source/topic examples through #17 (harness contracts), #20 (live
maintenance integration) and #18 (acceptance).
Numeric caps are configurable defaults; tune on development data, not frozen
acceptance questions. No measured quality improvement is claimed here.

## P07: Bounded continuations and explicit termination

A logical topic decision keeps one ID, immutable input/source/page versions,
selected card/page IDs and a persisted inspection ledger. An inspection window
records original/page locators, text hashes, reviewed claims, qualifiers,
remaining required ranges and outcome. Notes are routing evidence only; final
publication still needs the original-support review from V01. The planner may
reuse a window only if all its text and dependency versions still match.

| Allowance | Bound across the entire logical decision |
| --- | --- |
| Candidate selection | At most 16 distinct cards and three distinct detailed pages |
| Detailed inspection | At most six distinct windows, including the initial one; each at most 6,000 detail tokens |
| Inspection model requests | At most seven total, including one shared repair/provider-retry allowance |
| Topic planner requests | The existing three total, including expansion and replanning |
| Decision wall deadline | 600 seconds from its first claim, including continuation queue waits; child requests also obey P05's 120/45-second limits |

Select a window from required uninspected source/page ranges. Completion removes
those ranges from the ledger or records a terminal reason; replaying the same
window without new outcome is not progress. The final planner decision reads the
ledger and relevant original spans within its input cap. If unresolved context
cannot fit, or windows/cards/pages/calls/deadline are exhausted, mark the logical
decision failed with a needs_attention reason and the exact unresolved ranges.
Do not keep scheduling the identical failed task. The product offers an explicit
repair with revised scope/guidance or a versioned policy, linked to the old outcome.
New source/page revisions supersede stale work; they are identifiable new inputs.
A same-input transport retry returns the same outcome, not a fresh allowance.

Source-proposal overflow has a separate finite root-packet ledger: at most four
child packets and eight extraction requests total including the initial packet
and retries, with a 600-second deadline from first claim. Subdivide source spans
or consume already identified remaining topic IDs; record which obligations each
child covers. If subdivision cannot reduce remaining obligations, terminate with
needs_attention rather than repeatedly extracting the same four topics. Separate
root packets cover the finite source manifest; none can silently drop a passage.

Durable wait reasons identify the required index/reservation event. Requeue only
while the applicable persisted budget remains, otherwise record failed status.
Cached successful windows can support a later explicit repair only at unchanged
hashes; the new repair has its own attributable budget. This protocol bounds one
decision and makes unresolved work actionable; it does not promise every large or
ambiguous page can be maintained automatically.

## P08: Retirement when current support disappears

Separate page lifecycle (active, retired, redirect, split_entry) from maintenance
freshness/status. Active pages may be fresh or pending/failed revalidation. A
retired page has retirement metadata and historical content, not fresh answer
content. Retirement is a successful domain outcome, not an extraction failure.

Retire as no_current_support only after the mandatory dependency walk and support
review for the page finish, every previously retained factual claim lacks current
eligible support, and no unresolved check could change that result. Revalidate
tracked source revisions and relevant replacement passages; this establishes lack
of current support for this page, not proof its subject does not exist anywhere.
An unavailable index, failed model review or unresolved identity leaves the page
pending/failed instead of proving retirement. With some supported claims, publish
an audited reduced page and keep conflict/removed-content history.

Publish retirement metadata, removal from active navigation/search membership,
updated catalogue revision and the operation outcome atomically. Preserve the
stable page ID, old versions, inbound links and a deterministic historical-page
notice with reason/time. Keep its descriptor in topic matching so new supported
material can reactivate the same page through a newly reviewed version. Retired
prose remains excluded from current answers. Redirect/split entries retain their
own semantics; retirement does not delete or redirect original source citations.

After retirement, maintenance can report succeeded with page disposition retired;
report this explicitly instead of presenting it as a newly ready content page.
Later explicit restoration of unsupported history remains a historical/pending
view and cannot reactivate current answer eligibility without new valid support.
#10 owns retirement/revival, #11 preserves it across restructure/restore, #16
verifies atomic recovery, and #20 reports retirement separately from failures.
