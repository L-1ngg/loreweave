# M02: Sources

M02 makes supplied Markdown a versioned, addressable source of evidence. It owns
activation; identity, Wiki and graph jobs consume the resulting revision event.

## Interface

- Submit a new source or update an identified document, with trusted scope,
  an operation key and the expected prior version for updates.
- Submit an attributed factual correction note or retained maintenance guidance.
- Inspect document versions and import readiness.
- Resolve immutable passage references and validate source-version dependencies.
- Read eligible source search records under a trusted scope.

## Ownership and dependencies

Own documents, source versions, original bytes/text, locators, parsed passages,
lexical fields, vectors and the effective-version pointer. Use M08 for durable
work and transactionally acknowledged operations. Parsing, tokenization and
embedding are internal adapters. Do not call Wiki/Graph synchronously on import.

## Invariants and failure behavior

IDs are independent of filenames. Preserve source bytes; derived offsets name
their decoded representation. Support prose, lists, text tables and fenced code;
images supply links/alt text only. Build searchable candidates before activation.
A transaction validates the expected prior version, activates the prepared
version and queues identity-proof revalidation plus Wiki/graph maintenance.
The [identity proof policy](../policies/identity-provenance.md) defines immediate
transitive invalidation without waiting for a reconciliation worker. A late import cannot overwrite a newer version
without an explicit new update decision.

An identical operation retry returns its existing result. A changed payload
under the same key fails. Invalid encoding/parse/embedding leaves the old active
version intact. Source changes invalidate dependencies immediately by authoritative
version checks, even when downstream jobs have not run. Separate-document conflicts
follow applicability, not last-upload-wins.

## Acceptance boundary

Submit Markdown through the product, inspect the original passage and citation,
then revise it and verify current retrieval changes while old citations still
resolve. Race two updates and fail the embedding/activation step. Verify neither
exposes a half-prepared version or produces duplicate document updates.
