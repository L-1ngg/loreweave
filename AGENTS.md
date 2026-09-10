# LoreWeave project guidance

Global communication and execution rules remain in
[/home/l1ngg/.agents/AGENTS.md](/home/l1ngg/.agents/AGENTS.md).

## Design and implementation context

For the redesign, start at [the construction blueprint](docs/rag-v1-blueprint.md)
and [the module map](docs/design/rag-v1/README.md). Read the selected module's
contract and relevant ADRs before changing its behavior. The existing Python
implementation is described separately by [architecture](docs/architecture.md)
and [contracts](docs/contracts.md); it is not the target Bun implementation.

For domain terminology, read [CONTEXT.md](CONTEXT.md). For the source of a
decision, consult [the discussion record](docs/rag-optimization-design.md).
Routine design and evaluation choices are delegated; implementation and delivery
scope come from the active user request, not a ticket's readiness label.

## Agent skills

### Issue tracker

Use [LoreWeave GitHub Issues](https://github.com/L-1ngg/loreweave/issues) for
current specs, work items, dependencies and execution evidence. Read
[tracker conventions](docs/agents/issue-tracker.md) when creating, refining or
executing tickets. Forge integration defect reports go to the separately
authorized upstream repository under Q38. Local `.scratch/rag-v1` spec/ticket
files are archived migration snapshots; read the linked live issue before work.

### Domain docs

Use one project glossary and [docs/adr](docs/adr) for architectural rationale.
Read [domain-document conventions](docs/agents/domain.md) when updating them.
