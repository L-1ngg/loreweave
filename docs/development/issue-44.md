# Issue #44: explicit immutable source updates

Ordinary uploads remain distinct even for identical names/bytes. A raw multipart
Update file route supplies an explicit document ID, captured prior library revision,
stable submission key, source/operation/attempt and user-selected mode. Original
durability precedes acknowledgement. Preparation/failure retains the prior effective
source/index. Validated activation transactionally compares revision, latest operation,
latest attempt and retirement before changing both effective pointers.

Document details expose Update file, mode selection, processing/retry and retained
original versions. Already accepted questions keep their pinned source/index; new
questions resolve the current activation. Historical references and MCP resources
keep immutable source identity, never a filename/latest-file alias.

Ran: production build/typecheck and a composed public-HTTP/Playwright/official-MCP
test with real PostgreSQL. Same-name uploads had different IDs. Failed Flash update
left the old effective version readable. Standard and Flash updates activated only
after validation, response-loss duplicates reused the same operation and stale
revision requests rejected. An accepted delayed question retained its old version
while activation completed; a later follow-up read the newly effective version.
Old Web citations opened their exact version on desktop/mobile and old MCP page
resources remained readable. Mobile Update file completed in Standard. Competing
same-revision updates produced publication_conflict for the superseded operation
and retained the later validated activation. Passed.

Process interruption/retry uses #38's shared operation lifetime; #47 rechecks the
composed lifecycle matrix. Real-model index/QA quality remains separate. No commit/
push made.
