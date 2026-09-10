# Organization access bootstrap

Issue [#4](https://github.com/L-1ngg/loreweave/issues/4) implements M01 around the
scripted evidence/agent host. [SQL migration](../../migrations/0001_access.sql)
separates organizations, members, password hashes and login sessions from Forge
conversation history. The bundled demonstration source belongs to the organization
selected at server startup. Real multi-document ingestion follows in #5.

## Credentials and administration

Use the local bootstrap command in [README](../../README.md) to create the first
administrator. Repeating bootstrap with matching organization/admin credentials
is idempotent; it does not overwrite an existing administrator's password.
Passwords use Bun's Argon2id default. Login returns a random 256-bit token only
through an HttpOnly, SameSite=Strict cookie (Secure on HTTPS); the database stores
the SHA-256 token hash and a seven-day expiry. Tokens are not persisted in run
snapshots, event payloads, SDK messages or browser local storage.

Administrators create members with explicit grants, list members, revoke all of
a selected member's existing login sessions, and create project classifications.
Revoking existing sessions does not change the password or prevent a later fresh
login. Logout revokes the current token. There is no public administrator bootstrap
HTTP route and no default administrator password.

## Trusted operations and scope

The service resolves the cookie into an actor/organization and checks a named
operation grant. Host and transport both enforce their boundaries: run start,
inspection, event replay, cancel and historical reads cannot cross organizations.
Tool and model-call admission re-checks the credential so revocation prevents the
next operation, including one inside an already executing run. Already started
work retains the existing cancellation/settlement contract.

Tool definitions accept knowledge arguments only. Unknown model-supplied actor or
organization fields fail schema validation; the host supplies trusted context in
its closure. An authenticated browser cannot set actor/organization in a run body.
Read permission does not imply import/correction/restoration/admin permission.
Those knowledge mutation endpoints arrive in their corresponding later tickets.

Project selection is a relevance constraint, always including applicable shared
material. Project creation adds no membership table or visibility ACL. Historical
source navigation checks organization/read permission without applying the current
question's project relevance filter. Members of the same organization can inspect
organization conversations by link; this version has no per-conversation ACL.
Pre-authorization demonstration conversations retain a null organization and are
not assigned to a newly created account automatically.

## Verification boundary

Real PostgreSQL plus authenticated HTTP and Chromium cover login, administrator
member/project creation, member querying and session revocation. Public host tests
cover forged model arguments, revocation before the next operation, organization
isolation and project relevance versus historical visibility. Password/login
sessions and conversation sessions remain independent across reloads. These are
scripted-provider access tests, not real-provider semantic quality acceptance.
