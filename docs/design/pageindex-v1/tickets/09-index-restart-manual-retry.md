# P09: Recover interrupted indexing with explicit retry

**Status:** published snapshot; the live GitHub work item owns execution state.

**Live work item:** [#38](https://github.com/L-1ngg/loreweave/issues/38)

## Parent

[Spec #29](https://github.com/L-1ngg/loreweave/issues/29)

## What to build

An owner leaves/reopens indexing, recognizes process-interrupted work and manually retries it, including selecting Standard after Flash structural failure, without duplicate documents or unsafe stage reuse.

## Acceptance criteria

- [ ] Accepted indexing continues with no browser connected; status restoration reads the same operation/attempt and does not submit another upload.
- [ ] Application/worker restart marks unfinished prior attempts interrupted, including queued work, and does not automatically resume them or replay unknown model requests.
- [ ] A manual failed/interrupted retry retains original/version/document/operation identity, creates a new attempt and captures current mode/model settings.
- [ ] Explicitly switching a failed Flash attempt to Standard reuses only compatible validated extraction and regenerates incompatible mode-dependent tree/summary artifacts.
- [ ] Stage reuse checks original, parser/indexer revision and relevant configuration; unvalidated partial artifacts cannot be treated as completed work.
- [ ] All attempts retain inspectable progress/reasons/usage and enforced finite budgets, including failed and retried work.
- [ ] Fully validated publication remains guarded by document revision and retirement state; failure/interruption preserves any existing effective version.
- [ ] Public HTTP, crash/restart and desktop/mobile browser checks exercise both modes, status/retry identity and the absence of automatic fallback.

## Blocked by

- [#35](https://github.com/L-1ngg/loreweave/issues/35): Publish fully optimized Flash indexes
- [#37](https://github.com/L-1ngg/loreweave/issues/37): Complete Standard without a printed TOC

## Spec coverage

AC02, AC15, AC16, AC19, AC21, AC28. This is an allocation of relevant parent outcomes, not evidence that those outcomes have passed.

## Evidence to record

Record leave/reopen and restart/manual-retry demos, stage-manifest reuse/rejection, model-call counts and stable operation/document identities using real PostgreSQL.
