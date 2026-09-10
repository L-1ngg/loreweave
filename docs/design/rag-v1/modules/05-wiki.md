# M05: Wiki

M05 maintains readable cross-document topic pages, their publication state and
recoverable edits. It preserves the user's organization/correction intent.

The [topic maintenance policy](../policies/wiki-topic-maintenance.md) owns
candidate retrieval, mandatory dependency coverage, inspection limits, creation
gates and concurrent topic publication behind this module's maintenance interface.

## Interface

- Plan and execute a bounded maintenance operation for supplied source changes
  or a natural-language organization request.
- Read a page or historical version with source references and readiness.
- Restore a historical page or edit set against current source/identity state.
- Search published eligible page content as one retrieval route for M06.

## Ownership and dependencies

Own page IDs, topic/project scope, immutable page versions, dependency manifests,
edit sets, aliases/navigation entries, publication checks and retained guidance.
Also own the versioned topic catalogue, reverse page dependencies, routing
decisions and topic reservations; M08 persists their work cursors and attempts.
Read M02 evidence and M03 identities; use M08 for work. Graph availability is not
a prerequisite to page maintenance.

## Invariants and failure behavior

Prefer updating a matching topic; create independent new topics, merge substantial
same-scope duplicates and split independently useful subtopics. Preserve title-
independent page identity and historical citations. A split's old entry lists
successors; a merge's old entry points to its resulting page.

Check references, support, qualifiers and known conflicts before auto-publication.
Use separate semantic support review under
[V01/V02](../policies/evidence-validation.md): at most three generation and three
review requests per draft block, counted across retries. Review the entire final
published text in bounded blocks; unchecked connective prose cannot be appended.
A correctly displayed conflict may publish. Commit each related edit set
atomically with expected page/source/identity revisions. A failed candidate does
not replace a valid published page; stale published content remains marked and
excluded from answer evidence until revalidated.

Restoration creates new versions, preserves later unrelated edits and keeps the
restoration reason. Stale restored content may be browsed as pending update and
is revised against current sources; source versions do not roll back with it.

[P07/P08](../policies/wiki-topic-maintenance.md) specify finite inspection ledgers
for large pages and a separate page lifecycle: active, retired, redirect or
split_entry. Retire only after complete review proves all tracked current support
is absent; failures or unresolved checks remain pending/failed. Preserve historical
navigation and reuse the same page ID when later support justifies reactivation.

## Acceptance boundary

Import overlapping documents, browse one synthesized topic and follow its
citations. Add a conflicting or superseding source and observe pending/failed
refresh behavior. Merge/split/restore pages with intervening edits and verify
atomic navigation, preserved histories, explicit conflicts and current answers.
