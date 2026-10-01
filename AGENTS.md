<!-- intent-skills:start -->
## Skill Loading

Use `bun run intent:list` and `bun run intent:load <package>#<skill>` in this
checkout. Start's transitive dependency also claims the `intent` bin; these
root scripts select the installed Intent CLI explicitly. For compatibility
evidence, read `docs/development/pageindex-baseline.md`.

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

# LoreWeave project guidance

Global communication and execution rules remain in
[/home/l1ngg/.agents/AGENTS.md](/home/l1ngg/.agents/AGENTS.md).

## Design and implementation context

For the replacement, start at [Spec #29](https://github.com/L-1ngg/loreweave/issues/29),
[the construction blueprint](docs/pageindex-v1-blueprint.md) and
[the module map](docs/design/pageindex-v1/README.md). Read the affected module's
contract and relevant ADRs before changing behavior. The blueprint describes the
target; current runtime/validation commands are in [README](README.md) and root
package scripts. Read the selected live work item and its blockers before implementation.
For retired Python/Forge/Wiki/graph behavior or recovery, use the historical
[retirement record](docs/history/pageindex-retirement.md). For source attribution,
read [NOTICE](NOTICE.md).

For domain terminology, read [CONTEXT.md](CONTEXT.md). Current decision provenance
is in Spec #29's alignment notes and [ADR-0005](docs/adr/0005-pageindex-typescript-replacement.md).
Routine design and evaluation choices are delegated; implementation and delivery
scope come from the active user request, not a ticket's readiness label.

## Agent skills

### Issue tracker

Use [LoreWeave GitHub Issues](https://github.com/L-1ngg/loreweave/issues) for
current specs, work items, dependencies and execution evidence. Read
[tracker conventions](docs/agents/issue-tracker.md) when creating, refining or
executing tickets. Local `.scratch/rag-v1` files are historical snapshots;
[PageIndex ticket drafts](docs/design/pageindex-v1/tickets/README.md) are publication
inputs, not an implementation tracker. Use the linked live issue after publication.

### Domain docs

Use one project glossary and [docs/adr](docs/adr) for architectural rationale.
Read [domain-document conventions](docs/agents/domain.md) when updating them.
