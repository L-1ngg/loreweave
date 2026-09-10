# Pinned Forge SDK source

Imported from [Forge Agent](https://github.com/L-1ngg/forge-agent) at
`c5a4291def7f5346c428fe1c22d7b4d411742e23`; exact imported paths and original/patched
SHA-256 values are in [upstream.json](upstream.json). This is not a moving submodule.
Preserve [MIT license](LICENSE), the nested [runtime license](packages/core/src/runtime/LICENSE),
its [provenance](packages/core/src/runtime/upstream.json), and the upstream pi-ai patch.
The root workspace lockfile pins dependency resolution; use `bun install --frozen-lockfile`.

## Local patch 0001

[Request admission](local-patches/0001-request-admission.patch) adds an optional
synchronous `beforeModelRequest({ kind, signal })` host hook to the public SDK.
It wraps the shared model stream before dispatch for tasks, retries and summaries.
Returning admits the request; throwing denies it. Low-level scripted test ports
remain upstream behavior. No knowledge policy is embedded in vendor code.

The host uses one cumulative budget; it does not infer admission from events or
reset counts when finalization begins. SDK internal provider retries remain zero;
the Forge retry driver re-enters this hook for each attempt.

`tests/sdk-admission.test.ts` exercises actual loopback HTTP dispatch, retry and
summary admission. `bun scripts/check-vendor.mjs` detects unrecorded source edits.
Keep the patch while the pinned SDK lacks an equivalent pre-dispatch seam; remove
it only after pinning a reviewed upstream version and replaying these tests.
Upstream package documentation describes the original Forge repository layout and
is excluded from LoreWeave's local-document link scan.
