# Documents

The document library contains the documents currently available for discovery and
new questions. Use PDFs with a readable text layer. Scanned/image-only, encrypted
and malformed inputs receive explicit unsupported or failure outcomes. The current
upload limit is 50 MiB; [configuration](../development/configuration.md) describes
the page and work bounds.

## Import and choose a mode

Open Documents, choose a PDF and select its indexing mode. **Flash** is the default:
it constructs initial structure from layout and verified outlines, then optimizes
sections and creates navigation summaries. **Standard** constructs and verifies
structure with the index model, handling both printed tables of contents and
documents without one. Both modes create summaries and validate physical-page
coverage before the document is ready for questions.

The selected mode is retained. Failure does not automatically switch modes or
providers. Configure and verify the `index` role in [Settings](settings-and-mcp.md)
before importing. Model requests and indexing can incur provider charges.

An accepted import has an operation identity. Progress continues after navigation
or browser closure; returning to Documents observes the same operation. Extraction
or an inspectable draft alone does not mean the document has a completed index.

## Inspect and retry

Open a document to inspect its metadata, progress, tree and stored original pages.
Page targets are one-based physical PDF positions. Printed labels, such as Roman
numerals or a title-page offset, remain display information.

Failed and interrupted work retains its reason. Explicit retry creates another
attempt under current settings, retaining the accepted document and source. You
can deliberately choose Standard after a Flash structural failure. Compatible,
validated extraction may be reused; tree and summary work is rebuilt as required.
Application restart marks unfinished work interrupted and does not replay model
calls automatically.

## Update and remove

An ordinary upload creates an independent document even when its filename matches
an existing item. Use **Update file** on the intended document to supply a new
immutable version. Its previous effective version remains usable until the new
index validates and activates. Failed preparation leaves the previous version in
place. Historical citations keep their original version and physical page.

Removing a document takes it out of current discovery and new-question scope.
Authorized historical originals and citations remain available. A pending update
cannot reactivate a removed item. Permanent original-file purging is outside the
current product scope.

Ask questions through [Conversations](conversations.md). Trees and summaries help
find pages; factual answers must be supported by actual original-page reads.
