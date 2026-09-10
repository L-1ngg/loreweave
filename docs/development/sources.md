# Markdown sources

Issue [#5](https://github.com/L-1ngg/loreweave/issues/5) adds durable imports to the
local development service. `SourceService` owns source content; `Operations`
shares PostgreSQL transactions for receipts, leased preparation and downstream jobs.

An upload stores an immutable attachment under its uploader, organization and
selected project. Uploading alone does not activate knowledge. Direct import or
the Forge `import_markdown` tool accepts it with a durable operation key. The tool
can select only attachments supplied to that run and rechecks current credentials.
The scripted provider only recognizes explicit affirmative import examples; negative
or interrogative instructions produce a non-import receipt. It is not a general
natural-language intent model. The host records operation IDs in its persisted run snapshot; the deterministic
receipt makes no semantic-answer claim. Tool operation keys are
`run:<run-id>:attachment:<attachment-id>` so interrupted tool results can be
correlated with accepted effects. Browser imports use a stable key across retries.

Imports accept `.md` files up to 1 MiB. Source identities are independent of names.
Fatal UTF-8 decoding rejects invalid input; CRLF/CR/LF, BOM, bytes and decoded text
are retained. Passage locators use immutable UUIDs and UTF-16 offsets into that
exact decoded representation. Markdown-it preserves heading paths, lists, tables,
quotes and fenced code as whole passages. Link-definition spans retain their own
locators and index records; browser passages share the document reference context. Search-only chunks contain at most
2000 Unicode code points. Jieba terms plus complete technical identifiers feed
PostgreSQL `simple` tsvectors. No external links or images are fetched. Browser
Markdown disables raw HTML, provides image links/alt text, and offers original
text plus a byte-preserving download.

The worker prepares vector batches under one 45-second preparation deadline;
a 60-second database lease fences activation. Reclaimed work retains its attempt
count and stops after three preparation attempts. A failed preparation marks the
candidate failed and leaves the prior effective version untouched. Activation
checks the expected prior version, inserts all passages/index records, moves the
pointer and registers `identity.revalidate`, `wiki.refresh`, and `graph.refresh`
in one transaction. These downstream jobs remain queued until their respective
handlers are implemented; source eligibility does not wait for them.

Public `current` checks consult the document pointer immediately. Historical
versions and passage references remain resolvable within the organization;
project selection filters search relevance only. Public updates require document
identity and the expected prior version; natural-language update targeting is
#11, not implicit filename replacement.

The development embedding profile `controlled-sha256-v1` (8 dimensions) tests
storage and failure behavior only. It does not establish retrieval quality.
Status lists batch metadata reads without loading source bodies, and browser
polls wait for the preceding request to settle. Current tests cover real PostgreSQL restart/retry behavior, competing revisions,
invalid UTF-8/vectors, transaction rollback, scope isolation, Forge tool receipts,
and Chromium upload/status/original rendering. Broader lease reconciliation and
classified transient retries belong to #16; actual source answers belong to #6.
