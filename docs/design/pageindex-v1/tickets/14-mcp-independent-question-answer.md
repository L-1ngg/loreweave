# P14: Answer independent MCP questions through shared QA

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#43](https://github.com/L-1ngg/loreweave/issues/43)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

An external MCP client invokes question_answer using the configured server QA model, independently of Web history, and receives a bounded answer/citations or explicit clarification, evidence and coverage outcomes.

## Acceptance criteria

- [ ] Publish question_answer as the fifth public tool through the existing maintained MCP server; it calls the shared QA module directly.
- [ ] Each invocation creates an independent run with the verified token, optional library/selected scope, source bindings and captured server QA role, without a Web conversation prerequisite.
- [ ] Do not borrow external Agent model/history or register question_answer as a tool inside its own reading Agent loop.
- [ ] Enforce the same per-document reading policy, scope/visibility, current-run page-read registry, citation validation and finite budgets as Web QA.
- [ ] Return schema-valid answer/reference and explicit clarification/evidence-gap/incomplete/failure outcomes; retained resources resolve authorized immutable source identities.
- [ ] Separate invocations have distinct run identities/budgets and cannot carry another invocation's citation/scope/history as authority; revoked/forged credentials are denied.
- [ ] A real official MCP client discovers exactly the five intended tools, asks selected/multi/library/no-answer questions with controlled providers and verifies no mutation surface.

## Blocked by

- [#41](https://github.com/L-1ngg/loreweave/issues/41): Discover documents and ground scoped follow-up questions
- [#42](https://github.com/L-1ngg/loreweave/issues/42): Authorize MCP clients to read documents and page resources

## Spec coverage

AC08, AC09, AC13, AC14, AC16, AC22, AC23, AC25, AC28, AC29. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record actual official-client question calls, captured QA-provider routing, independent run/reference identities and shared scope/limit/error cases. Protocol success does not certify real-model answer quality.
