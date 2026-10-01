# LoreWeave

LoreWeave provides local PDF document-tree question answering under
[Spec #29](https://github.com/L-1ngg/loreweave/issues/29).
The [construction blueprint](docs/pageindex-v1-blueprint.md) and live issues
#30-#47 define delivery. The complete replacement and required local acceptance
are implemented; [AC01-AC35 evidence](docs/evaluation/pageindex-acceptance.md) and
[measured results](docs/evaluation/pageindex-results.md) record outcomes and limits.

The retired Forge/Wiki/graph/vector runtime has been removed after an external
archive and isolated restore. Its data and uncommitted source remain recoverable
through [the retirement record](docs/history/pageindex-retirement.md).

## Local startup

Use Bun 1.3.12 and PostgreSQL 17:

```sh
bun install --frozen-lockfile
bun run setup
docker compose up -d --wait postgres
bun run dev
```

Setup generates a private `.pageindex.env` with a random access password and
wrapping key. The new database is `loreweave_pageindex` on port 45434 and
originals use `.pageindex-data/originals`. Old configuration and data are never
loaded implicitly. Setup selects fixture mode, which accepts only loopback
providers. For normal use set `LOREWEAVE_MODE=real` in `.pageindex.env` or the
process environment. `LOREWEAVE_PORT` defaults to 41737; an occupied port is
preserved and the next available port is printed.

For the compiled Bun entry:

```sh
bun run build
bun run start
```

Open the printed URL and log in with `LOREWEAVE_ACCESS_PASSWORD` from the private
configuration. Settings saves encrypted server-held OpenAI/compatible connections
and separate `index`/`qa` model roles. Use a Base URL ending in the provider's API
prefix (usually `/v1`), then verify each role. Accepted work captures its connection
revision, Model ID and finite budgets; later edits apply to new work.

Document library imports text-layer PDFs with Flash selected by default or
independent Standard indexing. Both produce navigation summaries; Flash also
merges and subdivides sections. Indexing continues after navigation or closure.
Failed/interrupted imports require explicit retry. Update file targets one
document, while another ordinary upload creates an independent document even
with the same filename. Removing an item from the current library retains its
historical originals and citations.

Conversation supports saved history, current-library discovery, selected-document
scope, streamed reading activity and physical-page citations. Refresh/closure
detaches the observer while accepted questions continue. Stop explicitly cancels
the run. Startup marks unfinished prior work interrupted without model replay.
Desktop citations show the bound original alongside the answer; mobile opens the
original separately and returns to the originating conversation position.

Settings issues named MCP tokens once and revokes each independently. Connect an
external client to `<printed URL>/mcp` with `Authorization: Bearer <token>`.
The five tools are `browse_documents`, `get_document`, `get_document_structure`,
`get_page_content` and independent `question_answer`. Immutable page resources
use `loreweave://sources/<versionId>/pages/<page>`. Tokens cannot administer the
Web library or settings.

## Verification

```sh
bun run typecheck
bun run test
bun run test:conformance
bun run build
bun run check:baseline
bun run test:browser
bun run check:docs
bun run format:check
```

[Baseline evidence](docs/development/pageindex-baseline.md) explains the exact
package/runtime probes and observed adapter details. Controlled probes verify
protocol and lifecycle behavior. Real-model quality has separate original-evidence
review in the final evaluation; neither fixture results nor upstream scores are
substituted for measured TS answers. Captured limits are in
[work bounds](docs/development/pageindex-limits.md).

The final corpus has 15 inputs per mode, with Flash 11/15 and Standard 12/15 ready.
The latest 22 Web and two independent MCP outcomes were reviewed against their
immutable originals. Rejected imports, failed earlier trials, provider usage/cost,
latency and review limitations remain in the measured report. Use `bun run
eval:compare` and `bun run eval:report` to recompute its artifact metrics without
making model calls. Paid re-execution is documented separately in that report.

The browser suite creates and removes a disposable real PostgreSQL database and
artifact directory. Persistence conformance uses Node 24 for its Vitest tool,
while application dev/build/compiled serving runs on Bun. Paid evaluation is
opt-in through `LOREWEAVE_EVAL_PROVIDER_FILE`; its private JSON contains
`baseURL`, `model`, `apiKey` and `maxUSD` (at most 10). The accounting proxy
requires the selected gateway's `/v1/usage` contract. It never runs inside the
application or silently loads an old connection.

Application deployment packaging is deferred. The Compose service provisions
only the independent local development database.
