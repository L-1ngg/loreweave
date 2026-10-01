# P13: Authorize MCP clients to read documents and page resources

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#42](https://github.com/L-1ngg/loreweave/issues/42)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The owner creates/revokes named MCP tokens in Settings, and an external Agent uses the four shared reading tools and immutable resources over Streamable HTTP without invoking the server QA model.

## Acceptance criteria

- [ ] Settings creates named unpredictable tokens, reveals plaintext only at creation, lists nonsecret metadata and revokes clients independently; verification state survives application restart.
- [ ] Plaintext does not reappear in later settings/detail/history/browser reads, and an MCP read credential cannot administer Web documents, model settings or tokens.
- [ ] Mount one shared TanStack MCP server instance through raw Start GET/POST/DELETE routes with verified per-request token/context and unchanged SDK Responses; use the supported Streamable HTTP surface without introducing an OAuth authorization-server product.
- [ ] Expose browse_documents, get_document, get_document_structure and get_page_content from the same shared definitions as in-process QA, with bounded metadata/tree/page outputs.
- [ ] Standalone tools/resources validate current token access, document/version/page relationships and authorized immutable/historical inspection without requiring a Web conversation.
- [ ] A real official MCP client initializes, lists/invokes all four primitives and resolves immutable page resources; these calls make no server QA-model request.
- [ ] Revocation denies subsequent tool/resource use, including existing-session requests, while other tokens and Web access remain usable.
- [ ] Expose no document/configuration mutations or internal Agent tools; high-level question_answer is completed independently by P14.

- [ ] Token-management Form/Query state exposes nonsecret metadata and transient one-time plaintext only; invalidation and SSR hydration never retain the secret.

## Blocked by

- [#35](https://github.com/L-1ngg/loreweave/issues/35): Publish fully optimized Flash indexes

## Spec coverage

AC13, AC14, AC25, AC33, AC34. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record token create/list/reopen/revoke/restart behavior, official-client protocol calls, immutable resource identity and zero QA-model calls for primitive reads. The finished five-tool surface is checked again in P14.
