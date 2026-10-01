# P03: Configure model connections and index/QA defaults

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#32](https://github.com/L-1ngg/loreweave/issues/32)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner saves server-held OpenAI-compatible connections and assigns independent or shared index and QA defaults through Settings; newly created work captures the selected configuration while existing captured work keeps its revision.

## Acceptance criteria

- [ ] Settings supports Provider, server-held API Key, optional adapter-supported Base URL and Model ID selection for the index and QA roles.
- [ ] The roles can share or use different connections/models; typed output, tool calling and streaming use the maintained TanStack adapter rather than a parallel raw-provider loop.
- [ ] Persist connection/default-role state and immutable configuration/credential revisions; captured queued/active work retains its revision after connection/key/default edits.
- [ ] Saved API Keys are sealed server-side and are not returned through list/detail/history/browser state or routine logs; model traffic originates from the application.
- [ ] Support official OpenAI and capability-verified compatible endpoint profiles; missing, incompatible or failed configurations have explicit outcomes without silent provider switching.
- [ ] Controlled endpoints verify Base URL/Model ID/authentication routing and the required structured/tool/stream protocol paths; record which actual endpoint/model combinations remain unverified.
- [ ] Use finite documented system budget defaults with no additional first-version budget-control UI, native Anthropic/Gemini adapter or unrelated account/settings framework.

- [ ] Use Form and shared/server-validated schemas for connection/role settings and Query for nonsecret metadata; submitted API keys remain transient input and never enter persisted/dehydrated client caches.

## Blocked by

- [#31](https://github.com/L-1ngg/loreweave/issues/31): Open the local single-owner Web workspace

## Spec coverage

AC28, AC29. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record Settings persistence, secret-return checks, captured-revision tests and controlled endpoint routing. Actual role routing is exercised again by indexing/QA slices; real-provider compatibility remains separate evidence.
