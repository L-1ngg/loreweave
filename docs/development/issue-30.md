# P01 execution evidence

Validated 2026-10-01 in the local dirty checkout, HEAD
`90eafdec9123802674cabcfa01afbc7ac3ec4796`. No commit or push was made.

- External private archive, manifest, byte comparisons and isolated database
  restoration passed as recorded in `docs/history/pageindex-retirement.md`.
  Recovery includes ignored/private/untracked files, Git state and four old
  Docker volumes. The active repository has no recovery runtime copy.
- Removed 360 retired implementation/fixture/vendor files, old migrations,
  exclusive runtime dependencies and the old configuration. Current design,
  unrelated work and source notices were preserved. All 26 current design
  documents matched their archive copies. Old runtime documentation is marked
  historical, with recovery provenance; historical licenses remain available.
- Locked the selected TS/Bun/Start/React/Router/Query/Form/AI/persistence/MCP/Intent
  set; local Intent discovery/loading and dry-run/install passed. No Hono layer
  is required. Exact versions and observed adapter details are recorded in
  `docs/development/pageindex-baseline.md` and `bun.lock`.
- A separate PostgreSQL 17 service/database/volume uses port 45434. The root
  scripts read only new configuration and do not run legacy migrations. Fixture
  startup cannot dispatch paid model requests. Setup/build/dev/compiled entry,
  typecheck, PDF tests, docs links, formatting and legacy source/dependency scans
  passed. Existing services and historical volumes were preserved.
- After isolating the probe at `/baseline-probe`, build/typecheck and the compiled
  HTTP/browser probe passed again. `pageindex-baseline-evidence.json` records
  SSR/Query hydration, protected RPC and anonymous rejection, server-only bundle,
  actual SQL, PDF upload/GET/HEAD/exact Range, SDK SSE (first chunk 31 ms), official
  MCP client 2.0.0, tool calling (2 calls), structured output (1 call), production
  with zero observers, replay (0 extra calls) and explicit SDK cancellation.
- The persistence probe verifies the maintained contract shape; the PostgreSQL
  store conformance and composed recovery workflow are later gates. No product
  workflow or real-model quality is claimed by these package probes.

Ran: archive/restore, database restore, removal/preservation checks, locked
installation, dev/build/compiled entry, typecheck, tests, docs/format checks and
compiled public-boundary probes. Not run: real-provider quality and complete
product acceptance, because those require the subsequent product modules.
Risk: PDF layout/indexing and canonical history remain unimplemented at P01.
