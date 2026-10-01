# Evaluation evidence

[The evaluation method](../docs/development/evaluation.md) explains commands,
input selection, model traffic and publication. [Reviewed results](../docs/evaluation/pageindex-v1.md)
are authored documentation; raw outputs have different lifetimes.

| Location                                        | Lifetime                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `tests/fixtures/`                               | Frozen authored inputs and expected original evidence           |
| `evaluation/baselines/pageindex-v1/`            | Approved byte-preserved delivery evidence and checksum manifest |
| `.pageindex-data/evaluation/runs/<invocation>/` | Ignored mutable results from tests/probes/evaluation            |
| External private storage                        | Credentials, private originals/logs and recovery backups        |

The artifact helper maps historical paths through the baseline manifest, verifies
frozen inputs when read and writes new results only to ignored run directories or
external destinations. Running a test does not publish a baseline. See the
[baseline index](baselines/pageindex-v1/README.md) for its scope and immutable files.
