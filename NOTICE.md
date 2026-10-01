# Sources and Attribution

PageIndex-style indexing and reading design refers to VectifyAI/PageIndex,
indexing revision `d2693d80791a86345ef78b3234834f5fe53a70a0` and reading
revision `f279431eb4e47884862961b9718df180552f417a`, under the MIT license.
The TypeScript implementation uses PDF.js as the PDF engine; it does not
deliver Python or PageIndex Cloud as a runtime dependency. The corresponding
license is retained in [docs/licenses/pageindex.txt](docs/licenses/pageindex.txt).
Adaptations and evaluation differences are recorded in the
[indexing documentation](docs/architecture/indexing.md) and
[measured report](docs/evaluation/pageindex-v1.md).

TanStack packages, PostgreSQL.js, Drizzle, React and the MCP client retain their
published licenses in installed packages. Mozilla PDF.js is Apache-2.0. The
minimal compiled Bun adapter follows TanStack Router's MIT-licensed
`examples/react/start-bun` Fetch-handler integration.

The retired Forge Agent/Pi/skills notices are preserved in
`docs/licenses/`; their exact pinned source/provenance and uncommitted
changes remain in the verified external recovery archive described in
[history and recovery](docs/history.md). Retention of these notices is attribution,
not an active execution dependency.

Frozen development PDFs are generated from project-authored source/layouts.
The Chinese fixture embeds a subset of Google Noto Sans SC under the SIL Open
Font License, retained at [docs/licenses/noto-sans-sc.txt](docs/licenses/noto-sans-sc.txt). Fixture manifests
pin PDF/font SHA-256 values. An encrypted development fixture was produced with
qpdf 12.2.0; neither qpdf nor the fixture font is an application dependency.
