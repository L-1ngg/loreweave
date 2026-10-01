# Issue #45: retirement with retained evidence

Retirement transactionally records a durable marker and advances the library
revision. Current browsing/discovery and every new QA eligibility check exclude
the document. Existing conversation selection stays selected and fails explicitly;
history/cache content never widens scope or makes a retired source eligible.
Effective/historical sources, pages, trees and references remain stored. Current
Web/token authorization still gates historical inspection. Update/retry/late
activation cannot reactivate a retired item.

Ran: production build/typecheck and composed public-HTTP/Playwright/official-MCP
checks against real PostgreSQL. Mobile retirement removed current discovery, stale
Web follow-ups and MCP question_answer rejected, while old page resources and exact
desktop/mobile citations resolved. Revoked tokens lost historical access; Web and
other documents remained usable. A pending update and a never-published new upload
failed publication_conflict after retirement; retry_obsolete denied resurrection.
A fresh compiled application process restored retirement, excluded discovery and
resolved the authorized historical resource. All passed.

No permanent purge/retention administration was added. Real-provider semantic
quality is separate from these access/lifecycle checks. No commit/push made.
