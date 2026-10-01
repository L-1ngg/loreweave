# P02: Open the local single-owner Web workspace

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#31](https://github.com/L-1ngg/loreweave/issues/31)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

The sole owner signs in with a runtime-configured password and reaches Conversation, Document library and Settings on desktop/mobile, with protected server-owned data and predictable navigation.

## Acceptance criteria

- [ ] Valid configured-password login creates owner access; invalid/missing access cannot read protected library/history/original/settings endpoints.
- [ ] Password reset uses runtime configuration, with no registration, organizational accounts, member roles or email recovery.
- [ ] One trusted server owner identity governs documents, conversations and model settings; client-supplied identities cannot create another owner or widen capabilities.
- [ ] Conversation is the default authenticated entry; the three working views and legitimate authenticated deep links remain reachable on desktop/mobile.
- [ ] Persist the owner identity and required session verification state using the new PostgreSQL stack and standard session/cryptographic facilities.
- [ ] MCP read credentials cannot act as Web login or management credentials; later MCP integration uses the same owner/capability contract.
- [ ] Public HTTP and Playwright checks cover valid/invalid login, protected reads, logout and navigation; no runtime implementation is represented as verified merely by a design label.

- [ ] Use Start/Router for the three views and authorized deep links, Query's official SSR/hydration integration for protected metadata and Form for login; each SSR request has an isolated QueryClient.
- [ ] Logout/session loss clears private Query and AI presentation state; browser bundles and hydration payloads exclude server modules, credentials and artifact paths.

## Blocked by

- [#30](https://github.com/L-1ngg/loreweave/issues/30): Archive legacy code and prepare a clean construction baseline

## Spec coverage

AC14, AC32, AC33, AC34. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record public access-control outcomes, owner persistence and desktop/mobile navigation checks against a disposable real PostgreSQL database.
