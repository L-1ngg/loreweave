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
archive. Research material, `.archify/`, current design documents, ADRs and
historical ticket snapshots are preserved. Retired source links in historical
documents resolve through this exact private baseline or the pinned Git
revision for committed content; they are not current executable paths.

Historical licenses remain in `docs/history/licenses/`. The replacement uses
an independent database, configuration and artifact directory. No legacy
migration or implicit old-configuration loading is permitted.
