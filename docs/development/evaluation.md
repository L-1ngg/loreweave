# Evaluation harness

Issue #17 supplies executable source-answer evaluation; #20 owns real maintenance
capture and #18 owns human/real-provider acceptance. Controlled fixtures establish
report correctness and scheduling only. No real quality, latency or capacity target
is certified by this harness.

Run against a disposable PostgreSQL database:

```sh
TEST_DATABASE_URL=postgres://... bun run test:evaluation
TEST_DATABASE_URL=postgres://... bun run eval:fixture /tmp/new-evaluation-output
```

The fixture creates an isolated organization, imports a separate Markdown original,
then queries the real authenticated HTTP answer interface with a read-only member.
It writes source manifests, development datasets and reports for a supported answer
and a provider returning the wrong numeric fact. The latter must fail the product's
support review and the evaluation. Missing Wiki/graph endpoints remain unavailable.
No question, reference answer, rubric, human label or generated answer is imported.

For a prepared corpus, use a session belonging to a member with only the `read`
grant. Set `LOREWEAVE_EVAL_TOKEN` in the process environment. The harness checks the
grant before answering, so benchmark instructions cannot execute knowledge edits.
Start each experimental runtime with `LOREWEAVE_RETRIEVAL_PROFILE` set to `source`,
`wiki`, `graph` or `combined`. All four include the original hybrid source baseline;
Wiki and graph are optional additions. An explicit graph experimental profile
attempts graph retrieval on every question. The ordinary development runtime keeps
its existing automatic relationship routing when the variable is absent.

```sh
bun run eval:run --manifest manifest.json --dataset development.json \
  --source http://127.0.0.1:41736 --output new-report.json
```

Add `--wiki`, `--graph`, `--combined` with independently configured HTTP endpoints
for the same frozen corpus. Runtime metadata is checked through `/api/runtime`;
model, policy, retrieval, context and common budget identifiers must match. Profile
mismatch or missing services yields unavailable cases with intact denominators.
The repository runtime currently uses controlled models; these endpoints do not
supply a real-provider deployment. Reports never contain session credentials.

Schemas are versioned in `src/evaluation/schema.ts`: the source manifest records
immutable version IDs, SHA256 of exact decoded text, project scope, parser and
embedding profiles. Each question records complexity, evidence-condition category,
reviewed original references, required points, expected gaps, diagnostic tags and
a paraphrase group. Hashes use SHA256 of `JSON.stringify` of schema-normalized
objects. The fixture output is an executable format example.

Prepare 50 development questions (40 ordinary/10 complex). Separately prepare
200 acceptance questions (160/40), including sufficient, missing and conflicting
source evidence according to the evaluation plan. Human reviewers must check
references and manually group paraphrases before freezing. The runner rejects
unreviewed references, exact normalized question overlap and shared paraphrase
groups; semantic overlap beyond that still requires the human preparation pass.
Acceptance mode requires a frozen timestamp, the development dataset hash and
`--development development.json`. There is no acceptance tuning or ingestion API.

Every submitted case remains in its category denominator, including errors,
timeouts, partial answers and missing routes. Reports retain raw retrieved evidence,
answers, certificates, actual locator/text/current-version/scope checks, exact
reference recall (a diagnostic, not the final correctness criterion), completion,
queue/retrieval/generation/review timing, model and embedding request counts.
Delivery latency ends before evaluator citation/grade reads. Provider token usage
and monetary cost currently remain unavailable, not fabricated zeros. Maintenance
adapter records have explicit availability, versions and numerator/denominator;
source-only runs cannot claim maintenance metrics.

Fixture mode uses a labelled deterministic oracle. Human mode always leaves viable
answers pending independent review; product support review is not a human score.
Create a grades file matching `humanGradesSchema` in `src/evaluation/grading.ts`,
with the exact report hash, case/profile identity, reviewer/time and separate
correctness, completeness, citation support and gap/conflict judgments. Apply it
without modifying the original report:

```sh
bun run eval:grade report.json human-grades.json new-graded-report.json
```

Human grading may accept equivalent valid original evidence beyond the suggested
reference locators. It cannot turn broken citations, failed requests or unavailable
routes into passes. Record disagreements and resolution in review notes. Reports
and grades are artifacts outside the knowledge corpus; output paths must be new.
