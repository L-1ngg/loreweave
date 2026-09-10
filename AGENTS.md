# My-RAG project guidance

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

Use local Markdown for My-RAG specs and work items. Read
[tracker conventions](docs/agents/issue-tracker.md) when creating, refining or
executing tickets. Forge integration defect reports go to the separately
authorized upstream repository under Q38, not to a presumed My-RAG remote.

### Domain docs

Use one project glossary and [docs/adr](docs/adr) for architectural rationale.
Read [domain-document conventions](docs/agents/domain.md) when updating them.
