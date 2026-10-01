# Captured work bounds

All defaults below are positive integer runtime configuration, captured once
with each accepted attempt/run. Settings intentionally has no budget UI.

| Variable | Default | Meaning |
| --- | --- | --- |
| LOREWEAVE_INDEX_CALLS | 120 | Total index model requests, including unsuccessful work |
| LOREWEAVE_QA_CALLS | 16 | QA model requests across tool iterations |
| LOREWEAVE_QA_TOOL_CALLS | 60 | Run tool invocations |
| LOREWEAVE_INDEX_PAGES | 2000 | Physical pages accepted per index attempt |
| LOREWEAVE_QA_PAGES | 160 | Page reads in one QA run, including cache reuse |
| LOREWEAVE_CONTEXT_CHARS | 60000 | Original/model request context characters |
| LOREWEAVE_OUTPUT_CHARS | 100000 | Total delivered answer characters |
| LOREWEAVE_INDEX_TIMEOUT_MS | 1800000 | Elapsed indexing attempt bound |
| LOREWEAVE_QA_TIMEOUT_MS | 180000 | Elapsed QA run bound |

Provider adapter retries are disabled; failed provider calls consume the same
captured work budget. Each request also has at most 120 seconds of adapter
timeout. Exhaustion is an explicit failure/incomplete reason, never exhaustive
absence. Product extraction/read/tree pagination and output limits are recorded
with their composed execution evidence. Real provider cancellation/billing is
separate from a local controller's abort result.

Model-connection verification has a finite total deadline of the captured role
deadline, capped at 180 seconds, for its tool/stream/structured three-request
probe. The initial 30-second shared deadline was insufficient for the authorized
gateway and cancelled structured finalization after the first two requests;
that failure remains in `pageindex-real-preflight-failures.json`. Per-request
adapter timeout remains at most 120 seconds. Real evaluation uses a development
accounting proxy with an 8192 output-token cap and serialized dispatch. That
comparison control is not a hidden application setting.

The current import limit is 50 MiB of PDF bytes. Library/tree requests allow
at most 50 records; a tree response is additionally bounded to 12,000 serialized
characters. One page request accepts at most eight physical pages and returns
at most 18,000 text characters with an explicit continuation. Selected scope
contains at most 30 documents. Original extraction accepts at most the captured
page limit; construction/summary windows contain at most eight pages and obey
the captured context bound. A single page that cannot fit is explicitly refused.

Indexing uses one worker in this local process. Each Web conversation permits
one active accepted question; other conversations and independent MCP questions
can run concurrently. The database pool has eight connections. There is no
claimed global QA throughput guarantee or provider-wide concurrency quota.
The development evaluation proxy serializes model dispatch for accounting;
that is distinct from application concurrency. Completed SDK stream logs have
a five-minute grace window and a 1,024-log pressure bound; durable PG history
remains the recovery source after eviction or application restart.

Measured latency/call counts and rejected imports are in
[the final evaluation](../evaluation/pageindex-results.md). These measurements
justify finite work bounds; the page/count caps are configuration limits, not
proof of quality or performance on a 2,000-page arbitrary PDF.
