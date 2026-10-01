# Verified retirement for PageIndex construction

The pre-replacement revision is `90eafdec9123802674cabcfa01afbc7ac3ec4796`.
Git history alone does not contain the uncommitted work in this baseline.
Before retirement on 2026-10-01, the complete working directory, including
ignored files, private configuration, untracked work, dependencies and `.git`,
was archived outside the active repository and restored in isolation. GNU tar
content comparison, restored HEAD and exact NUL-delimited Git dirty-state
comparison passed.

Private recovery storage is under
`/home/l1ngg/.local/share/loreweave-recovery/20261001-pageindex/` (mode 0700).
`manifest.json` records SHA-256 hashes for `worktree.tar` and four archived
Docker volumes: `my-rag_loreweave_postgres`, `my-rag_postgres-data`,
`my-rag_minio-data` and `my-rag_elasticsearch-data`. Each volume archive was
extracted and byte-compared in a separate location. The restored LoreWeave
PostgreSQL volume was started independently; all databases opened and logical
dumps completed, including the 50-table historical test database. The original
containers/volumes were not modified or removed. Private data and credentials
must never be included in GitHub evidence.

To recover, extract `worktree.tar` into a new directory, verify its revision and
dirty state against `git-status.nul`, and verify archive hashes against the
private manifest. Restore database volumes into **new** volumes/directories,
using the recorded PostgreSQL image. Do not overwrite the PageIndex checkout
or its new database. The verified example is `restored-worktree/` beside the
archives; logical PostgreSQL dumps and `database-restore.json` are also there.

The retirement inventory covers all previous `src/`, `web/`, `tests/`, `scripts/`,
`migrations/` and `vendor/forge-agent/` files (360 files), legacy root scripts,
Forge workspace/patch metadata and exclusive dependencies. Modified and
untracked files inside that retired implementation are recoverable from the
archive. At P01, research material, `.archify/`, current design documents, ADRs and
historical ticket snapshots were preserved. Retired source links in historical
documents resolve through this exact private baseline or the pinned Git
revision for committed content; they are not current executable paths.

Historical licenses remain in `docs/history/licenses/`. The replacement uses
an independent database, configuration and artifact directory. No legacy
migration or implicit old-configuration loading is permitted.

## Post-delivery residue cleanup

After replacement commit `72b8023083e1ca0eab69ad19e7af90cc6c339506`, the user
authorized removing obsolete Forge research and installation residue on
2026-10-01. The active checkout no longer contains these retired documents:

- `docs/research/forge-agent-reuse.md`
- `docs/research/forge-sdk-replacement-handoff.md`
- `docs/research/ingestion-concurrency-ha-options.md`
- `docs/development/forge-sdk.md`
- `docs/research/graphrag.zh-CN.md`
- `docs/research/llm-wiki-graphrag-feasibility.md`
- `docs/research/llm-wiki.zh-CN.md`
- `docs/research/siliconflow-request-settlement.md`

Their original versions remain in P01's complete recovery archive. The latest
dirty bytes, affected document pointers and installation residue were also
snapshotted in private recovery storage at
`forge-cleanup-20261001-IgIiAN/retired-residue.tar`. Its `plan.json` records the
archive hash, file hashes, literal symlink targets and preservation checks.
Extraction into the sibling `restored/` directory reproduced all 19,860 file
contents and 597 symlink targets before removal.

The remaining four Wiki/GraphRAG/provider investigations and their document
pointers were separately archived in `retired-research.tar`. Its seven file
hashes and successful extraction into `restored-research/` are also recorded
in `plan.json`. The active `docs/research/` directory is removed; the archived
investigations remain available for historical decisions and recovery.

The cleanup removes the remaining `vendor/` tree, including 11 old installation
links, plus 176 package directories absent from the current Bun lockfile and
178 associated links outside those directories. Actual dependency resolution
from the current root packages reached 224 package directories; none used the
removed installation directories. Current package versions, source, fixtures,
private configuration and historical licenses are preserved.

Historical ADRs, contracts and decision records now link here for the removed
investigations. PageIndex design and `.archify/` artifacts remain. The original
delivery manifest is the byte snapshot of the replacement commit; this later
documentation and installation cleanup is recorded separately here.

After removal, `bun install --frozen-lockfile --ignore-scripts` reported no
dependency changes. Typecheck, format checks, seven Bun tests / 55 assertions,
147 active Markdown links and Git whitespace checks passed. A separate scan
found no remaining Markdown links to the eight removed documents, and 237
preserved source/configuration/fixture/license/diagram file hashes matched.
The existing local service still served its canonical login URL with HTTP 200.
