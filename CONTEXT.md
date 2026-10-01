# LoreWeave Context

Domain language for document-tree question answering grounded in imported originals.

## Language

**Instance owner**:
The sole human owner of a local instance's document library, conversations and
model configuration. An authorized MCP client acts within that owner's access;
it is not another human account.

**Document library**:
The owner's collection of currently available documents for browsing and new
questions. Retained historical originals are distinct from current membership.

**Document**:
A stable library item whose identity is independent of its filename. A document
can have several immutable source versions while one is effective for new use.

**Source version**:
An immutable supplied original and the original-page content extracted from it.
A later upload to the same document creates another version rather than changing it.

**Physical page**:
A page's one-based position in its original PDF. A printed page label, including
a Roman numeral, is display metadata and need not equal that position.

**Document tree**:
A hierarchy of original-backed chapters/sections with titles and physical-page
ranges. Its summaries and headings guide navigation rather than supply answer facts.

**Index revision**:
One versioned document-tree/artifact result for a source version. Tree-node
identities and locations are interpreted within that revision.

**Flash**:
The indexing mode whose initial hierarchy comes from PDF layout and trustworthy
outlines, followed by optimization and navigation summaries.

**Standard**:
The indexing mode that constructs and verifies chapter structure with a model,
including documents with or without a usable printed table of contents.

**Navigation summary**:
A derived description of a tree section used to choose original pages to read.
It is not a substitute for factual support from those pages.

**Source activation**:
The point at which a validated prepared source/index becomes effective for new
use. Activation does not establish that one document supersedes another's claims.

**Document retirement**:
Removal from the current library and new-question eligibility, with historical
originals/references retained. It is distinct from permanent original-file purging.

**Knowledge operation**:
An identifiable accepted document import or update with durable progress and an
inspectable outcome independent of a browser conversation.

**Indexing attempt**:
One bounded execution of a Knowledge operation under a chosen mode/configuration.
A manual retry creates another attempt without another accepted document.

**Knowledge Agent**:
The conversational actor that interprets a question, chooses documents/pages and
answers within a bounded run. Its history supports interaction, not independent facts.

**Knowledge run**:
One bounded attempt to answer or clarify a Web or external Agent question, with
its own scope, source bindings, reading records and observable outcome.

**Query scope**:
The authorized library or explicit document selection that limits one Knowledge
run. Candidates discovered during a question do not redefine future scope.

**Page-read record**:
The record that a particular original physical page was accessed in a Knowledge
run, including authorized reuse of stored/cached page content.

**Source reference**:
A reference bound to an original source version and physical page that allows a
reader to inspect the evidence used by a specific answer.

**Traceable document question answering**:
Answering from imported original pages with identifiable version/page references.
Missing original support remains an explicit evidence gap.

**Unresolved source conflict**:
Incompatible original statements not reconciled by time, version or applicability.
The answer preserves each statement's source and relevant qualifications.

**Evidence gap**:
A requested factual conclusion without sufficient original-page support in the
run. It does not by itself establish absence from the whole library.

**Incomplete search**:
Discovery or reading whose coverage is limited by a bound, failure or unavailable
material. It is distinct from a semantically unsupported conclusion.

**Conversation**:
An owner-held sequence of questions, answers and run outcomes with retained query
scope. It is separate from the documents and originals its messages reference.

**Run attachment**:
Observation of an existing Knowledge run's saved and subsequent output. It is
not another question or another model execution.

**Stop**:
Explicit intent to cancel accepted question execution. Losing a viewer connection
alone is not that intent.

**Interrupted run**:
An unfinished execution whose application process did not complete it. Its
committed history remains inspectable without automatic execution replay.

**Support review**:
Assessment that a generated claim faithfully represents its cited original,
including qualifications. Valid reference location is not proof of semantic support.
