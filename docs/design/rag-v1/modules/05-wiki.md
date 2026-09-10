# M05: Wiki

M05 maintains readable cross-document topic pages, their publication state and
recoverable edits. It preserves the user's organization/correction intent.

## Interface

- Plan and execute a bounded maintenance operation for supplied source changes
  or a natural-language organization request.
- Read a page or historical version with source references and readiness.
- Restore a historical page or edit set against current source/identity state.
- Search published eligible page content as one retrieval route for M06.

## Ownership and dependencies

Own page IDs, topic/project scope, immutable page versions, dependency manifests,
edit sets, aliases/navigation entries, publication checks and retained guidance.
Read M02 evidence and M03 identities; use M08 for work. Graph availability is not
a prerequisite to page maintenance.

## Invariants and failure behavior

Prefer updating a matching topic; create independent new topics, merge substantial
same-scope duplicates and split independently useful subtopics. Preserve title-
independent page identity and historical citations. A split's old entry lists
successors; a merge's old entry points to its resulting page.

Check references, support, qualifiers and known conflicts before auto-publication.
Allow one generation plus two repair attempts, counted across job retries.
A correctly displayed conflict may publish. Commit each related edit set
atomically with expected page/source/identity revisions. A failed candidate does
not replace a valid published page; stale published content remains marked and
excluded from answer evidence until revalidated.

Restoration creates new versions, preserves later unrelated edits and keeps the
restoration reason. Stale restored content may be browsed as pending update and
is revised against current sources; source versions do not roll back with it.

## Acceptance boundary

Import overlapping documents, browse one synthesized topic and follow its
citations. Add a conflicting or superseding source and observe pending/failed
refresh behavior. Merge/split/restore pages with intervening edits and verify
atomic navigation, preserved histories, explicit conflicts and current answers.
