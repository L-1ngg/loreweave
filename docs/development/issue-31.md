# P02 execution evidence

Owner access is implemented in `src/server/access.ts`, with a singleton owner
and hashed opaque sessions in PostgreSQL/Drizzle. Runtime-configured password
verification uses Bun Argon2id. Session verification includes a keyed credential
revision, so a configuration password/key change invalidates old sessions.
Login rotates the current session; logout revokes it. Cookie state is HttpOnly,
SameSite=Lax, scoped to `/`, finite-lived and Secure on HTTPS. Non-GET owner
requests require same-origin headers. MCP bearer credentials cannot supply a
Web session. Auth inputs reject unknown fields; no client owner identity is used.

Start server functions enforce the data boundary. Router's protected layout
provides authenticated deep links and default Conversation navigation. Each SSR
request receives its own QueryClient. Login/logout clear private Query state;
an unauthorized Query error clears cached state and leaves the working layout.
AI presentation is added later inside that layout, whose teardown clears it.
The three views currently expose their P02 working navigation; document/model/
conversation workflows are the following slices.

Ran: `bun run typecheck`, `bun run build`, `bun run test:browser` (3 passed).
Desktop 1440x900 and mobile 390x844 verified invalid/valid login, protected deep
links, reload/session persistence, three-view navigation, anonymous direct RPC
rejection, HttpOnly cookies, logout, protected return and no horizontal overflow
or page errors. Screenshots were inspected. The checks created an independent
real PostgreSQL browser database and removed it and its temporary artifacts.
SQL confirmed exactly one persistent owner. Server secrets/DB helpers remain
behind compiled Start server functions; the bundle boundary gate is retained.

Not run: future product workflows and real-provider traffic. Why: outside P02.
Risk: access governs later boundaries too; each later raw route and management
function must apply the same capability contract and its own composed checks.
Local implementation remains in the authorized dirty worktree; no commit/push.
