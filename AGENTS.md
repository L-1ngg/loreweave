# LoreWeave project guidance

Global communication and execution rules are in
[/home/l1ngg/.agents/AGENTS.md](/home/l1ngg/.agents/AGENTS.md).

## Read by task

- For product behavior or runtime changes, read the selected live issue and parent
  specification, [architecture](docs/architecture/overview.md), affected
  [contracts](docs/architecture/contracts.md) and relevant ADRs. Read blockers'
  completion evidence before executing dependent work.
- For local setup and checks, use [README](README.md) and
  [testing](docs/development/testing.md); package scripts are the executable source.
- For model/indexing evaluation, read [the method](docs/development/evaluation.md)
  and the selected live issue's execution evidence. Distinguish controlled
  behavior checks from actual-provider semantic evidence.
- For documentation or tracker changes, read [CONTRIBUTING](CONTRIBUTING.md).
  [docs/README](docs/README.md) navigates current documents. GitHub Issues own
  scope, acceptance, dependencies, status and execution journals; local drafts
  use ignored `.scratch/`.
- For terminology/decisions, use the single [CONTEXT](CONTEXT.md) glossary and
  [ADRs](docs/adr/README.md). Current replacement rationale is
  [ADR-0005](docs/adr/0005-pageindex-typescript-replacement.md) and
  [Spec #29](https://github.com/L-1ngg/loreweave/issues/29).
- For retired behavior, read [history](docs/history.md); source
  attribution is in [NOTICE](NOTICE.md).

Current documents explain implemented behavior and durable contracts. Evaluation
outputs belong in ignored run directories or external archives; Git keeps reusable
fixtures, scripts and methods. Trial reports belong in GitHub Issues or external
storage; private recovery instructions stay with the external archive. Preserve
unrelated user work, private configuration, originals, external evidence archives
and `.archify/`.
Routine choices are delegated; task scope comes from the active user request
rather than ticket readiness.

<!-- intent-skills:start -->

## Installed package guidance

Before changing a TanStack integration, run `bun run intent:list`, then
`bun run intent:load <package>#<skill>` for matching installed guidance. Use
installed source and official version-appropriate documentation when a package's
skill is absent or stale. These scripts select the local Intent CLI explicitly
because Start's transitive dependency also claims its executable.

When updating generated mappings, inspect the same CLI's `install --dry-run`
before applying them and preserve project rules. Intent is development guidance;
it is separate from runtime model skills. Integration details are in
[Web/runtime](docs/architecture/web-and-runtime.md#intent).
<!-- intent-skills:end -->
