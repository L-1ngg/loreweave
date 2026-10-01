# PageIndex v1 evidence baseline

This is a byte-preserved evidence snapshot of the 2026-10-01 PageIndex delivery,
published at `0553b1a0c10b5aa7d723e5b21b3d83355e97e42f`. The implementation commit
was `72b8023083e1ca0eab69ad19e7af90cc6c339506`. [manifest.json](manifest.json)
maps original paths to current artifact files and pins all evidence/fixture hashes.

The [reviewed report](../../../docs/evaluation/pageindex-v1.md) explains measured
results and limitations. [Evaluation instructions](../../../docs/development/evaluation.md)
describe offline recomputation and opt-in paid runs. `bun run eval:verify` checks
every retained artifact and fixture; ordinary commands cannot overwrite this folder.

## Evidence groups

- `pageindex-real*.json` and `pageindex-large*.json` retain TS trials, initial and
  targeted failures, explicit retries, questions, readings and lifecycle records.
- `pageindex-full-reference.json`, `pageindex-encrypted-reference.json` and
  `pageindex-reference.json` retain the pinned isolated Python measurements.
- `pageindex-paired-comparison.json` and `pageindex-measurements.json` freeze
  selected-cohort comparisons and descriptive metrics.
- `*-ledger.json`, preflight failures and the index checkpoint retain calls,
  accounting intervals, cancellations and unavailable usage.
- Extraction/candidate/controlled-indexing and baseline-probe artifacts record
  protocol/layout checks independently of real-model semantic support.
- [Original acceptance snapshot](pageindex-acceptance.md.txt) and
  [original semantic review](pageindex-semantic-review.md.txt) preserve their exact
  recorded text as evidence, including historical relative links.
- [Original delivery manifest](pageindex-delivery-manifest.json) records the
  implementation's 236 source/configuration/fixture/doc files at delivery. It is
  not a checksum of the reorganized current checkout.
- Local-service/cleanup records and `pageindex-screenshots/` describe the measured
  service and subsequent disposable-resource cleanup at that time.

Embedded URLs, local database names, paths and statements about commit/push describe
the original execution. They do not assert current machine or GitHub state. Raw
Markdown snapshots use `.md.txt` so they remain evidence bytes rather than competing
maintained documents. Resolve their historical links with the manifest or the
[fixed published tree](https://github.com/L-1ngg/loreweave/tree/0553b1a0c10b5aa7d723e5b21b3d83355e97e42f).

These are synthetic authored originals and implementation-agent review, not a
population benchmark or independent blind score. Rejected inputs and earlier
failures remain attributable. Credentials and private recovery archives are not
included.
