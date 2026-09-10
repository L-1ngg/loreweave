# M01: Access and scope

M01 turns credentials and a user's project selection into trusted operation
context. It owns organization membership and grants; document applicability
belongs to M02/M06. See [shared contracts C01](../contracts.md#c01-identity-and-trusted-context).

## Interface

- Authenticate a browser session or external credential and return an actor
  bound to one organization, with explicit operation grants.
- Resolve a requested project scope, returning trusted scope or a clarification
  requirement; shared organizational material can remain eligible.
- Authorize a named domain operation before its effects.
- Manage member accounts and revoke credentials through administrator operations.

## Ownership and dependencies

Own members, sessions for login, API credentials and grants. Login sessions are
distinct from M07 conversation sessions. Receive database and credential hashing
adapters; expose no model-facing operation for setting the trusted actor.
Start with administrator-created accounts, password login and server sessions.
Members can read, import, correct and request Wiki restoration. Project metadata
organizes relevance, not member-specific visibility.

## Invariants and failure behavior

Revocation affects new operation admission. A model-supplied organization or
actor never replaces authenticated context. A grant permitting retrieval does
not permit import. Cross-project questions require explicit compatible scope;
a shared entity identity does not broaden it automatically. Return unauthorized
or ambiguous_target with safe details.

## Acceptance boundary

Exercise login and revocation through HTTP, then call the same knowledge
operation through browser and MCP credentials. Verify a read-only external
credential cannot mutate sources, two organizations cannot cross-read, and
shared material remains searchable within a selected project.
