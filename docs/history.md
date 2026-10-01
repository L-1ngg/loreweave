# History and recovery

The current application is the TypeScript PageIndex-style replacement. Current
startup, interfaces and checks are documented by [README](../README.md),
[architecture](architecture/overview.md) and [testing](development/testing.md).
Older commands/contracts are historical context, not current runtime instructions.

## Fixed historical revisions

| Stage                                                                     | Published record                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python retrieval system                                                   | [Fixed tree at d24fb0b](https://github.com/L-1ngg/loreweave/tree/d24fb0bce6e240930bba9940ead57f371601ded8)                                                                                                                                                |
| Forge/Wiki/graph implementation before replacement                        | [Fixed tree at 90eafde](https://github.com/L-1ngg/loreweave/tree/90eafdec9123802674cabcfa01afbc7ac3ec4796) and historical Issues #1–#28                                                                                                                   |
| PageIndex implementation delivery                                         | [Commit 72b8023](https://github.com/L-1ngg/loreweave/commit/72b8023083e1ca0eab69ad19e7af90cc6c339506)                                                                                                                                                     |
| Published construction/design/evidence before documentation consolidation | [Fixed docs tree at 0553b1a](https://github.com/L-1ngg/loreweave/tree/0553b1a0c10b5aa7d723e5b21b3d83355e97e42f/docs) and [historical ticket snapshots](https://github.com/L-1ngg/loreweave/tree/0553b1a0c10b5aa7d723e5b21b3d83355e97e42f/.scratch/rag-v1) |

GitHub Issues retain specifications, dependencies and execution evidence. The
current tree consolidates implemented behavior into topical documentation and
keeps a concise [PageIndex evaluation report](evaluation/pageindex-v1.md).
Raw evaluation records are preserved in external recovery storage.
Old ticket drafts, per-task journals, retired module documents and obsolete raw
reports are available from the pinned snapshots instead of another active archive.
The numbered [ADRs](adr/README.md) retain historical decision rationale.

## Private recovery

Git history does not contain pre-replacement dirty work, private configuration or
database content. Before cleanup on 2026-10-01, the full checkout (including ignored,
untracked and `.git` content) and four historical Docker volumes were archived
outside the repository in private storage. A real isolated restoration checked
archive/file bytes, HEAD and exact dirty status. Historical PostgreSQL was started
independently and logical dumps succeeded; original containers/volumes were retained.

The owner's recovery root is
`/home/l1ngg/.local/share/loreweave-recovery/20261001-pageindex/` (mode `0700`).
Its private `manifest.json`, `git-status.nul`, restored worktree, database-restore
record and logical dumps are the recovery authority. Later Forge/research cleanup
and documentation cleanup have verified additional snapshots beside it. Raw
evaluation records are retained there with their manifests and original bytes.
Credentials/private originals stay in that private storage.

To recover, verify archive hashes against the private manifest; extract the
worktree into a new directory and compare HEAD/dirty status against its recorded
baseline. Restore volume archives into new volumes/directories with the recorded
PostgreSQL image. Open the restored database independently and verify logical
dumps. Preserve the current checkout, configuration, database and originals.

Source licenses and pinned provenance remain in [NOTICE](../NOTICE.md) and
`docs/licenses/`. Historical delivery manifests remain in the external archives;
they describe their recorded revision rather than validating the current checkout.
