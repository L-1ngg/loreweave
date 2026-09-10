# Wiki history and structural edits

Issue [#11](https://github.com/L-1ngg/loreweave/issues/11) adds recovery and
restructuring behind M05's authenticated commands and browser pages. Run
`bun run test:wiki-history` with `TEST_DATABASE_URL` set to a disposable
PostgreSQL database. The development model contains explicit Chinese logistics
fixtures; it does not establish semantic quality on enterprise documents.

`WikiService.restructure` accepts a reason and one current page for split, or
two to three current pages for merge. It retains the request as a durable
proposal. Discovery proposals are enqueued with their parent publication;
workers also recover previously recorded proposals. The operation query exposes
proposal status, selected input revisions and the resulting edit set.

A bounded structure plan maps every non-title factual claim to successors. A
merge requires equivalent subject, aspect and applicability plus connected
overlapping supported claims. A split requires two to four independently useful
questions and retains conflicts with all of their related claims. Independent
structure review checks the map; normal original-support generation/review
checks each final content block. A final coverage review checks that all mapped
claims and qualifiers survive in the generated successors. Failed or incomplete
checks publish no part of the edit set.

Structure planning allows three requests, and the two structure reviews share
three requests including retries. They use the persisted 600-second operation,
120-second work-unit and 45-second request bounds. The existing 15,500-byte
model-input ceiling also applies: oversized required context terminates visibly
instead of silently dropping claims. These are initial implementation limits,
not a measured refresh SLA. Large-page automatic restructuring may require an
explicit repair or narrower request.

Page pointers, lifecycle, routes, catalogue revisions, source dependencies and
the edit-set record commit together under the worker fence. Current source,
identity and page revisions are checked in that transaction; changed catalogue
selection is not blindly retried. Historical page IDs and source citations
remain readable. Merge entries route to their retained canonical page; a split
entry lists successors. Routing follows these entries to current descriptors,
including historical titles and aliases, without admitting old prose as evidence.
Dependency walks follow the same routes to maintain current content.

`history`, `restore` and `restoreEditSet` support browser recovery. Restoration
requires the `restore` grant; restructuring requires `correct`. An accepted key
and payload identify one durable result. Restoring copies an immutable reviewed
version into a new version, with its reason and original dependency manifest.
Live eligibility makes stale source/identity bindings pending immediately, and
background revalidation updates them against current originals. Restoring a
retired page preserves retirement until fresh support justifies reactivation.

Edit-set recovery changes only the recorded pages, leaving later unrelated pages
alone. An intervening change to a related page returns focused clarification;
a race after acceptance records the same reason without partial effects. Pages
created by a reversed split become retained entries pointing back to the restored
topic. Source versions never roll back. The user's reason remains guidance,
not factual evidence. Rejected/reversed structures are suppressed on the same
page/source/identity inputs; new evidence, new guidance or an explicit new
request can be reviewed again.

Product routes are `GET /api/wiki/:id/history`, `POST /api/wiki/:id/restore`,
`POST /api/wiki-restructures` and `POST /api/wiki-edit-sets/:id/restore`.
The page browser offers human-readable history, successor links and forms with
required reasons; it does not ask members to type internal IDs. General
conversational targeting remains the responsibility of #14.
