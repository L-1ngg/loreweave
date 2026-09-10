# LoreWeave Context

Domain language for questions and evidence grounded in imported documents.

## Language

**Traceable document question answering**:
Answering a question from imported documents with supporting source passages and
identifiable source locations. Missing support is an explicit evidence gap.

**Evidence retrieval**:
Finding original passages in imported documents that support a user's or external
Agent's question, together with their source locations and necessary context.

**Wiki page**:
A maintained, directly readable topic in the knowledge base whose claims are
traceable to source material. A page may integrate several source documents,
and one source document may support several pages; pages and graph entities
need not correspond one to one.

**Unresolved source conflict**:
An incompatibility between source statements that cannot be resolved by their
time, version, or scope of applicability. Both statements retain their source
references and remain visibly disputed in relevant Wiki content and answers.

**Wiki content pending update**:
Previously published Wiki content awaiting refresh after a source change affects
its applicability. It remains visibly marked for readers while questions about
the affected content use applicable original evidence instead.

**Knowledge entity**:
A person, system, component, concept, or other identifiable subject represented
with a shared identity across Wiki content and the knowledge graph. Identity is
grounded in evidence about the subject; a shared name alone does not establish
that two references denote the same entity.

**Graph relationship**:
A source-supported connection between knowledge entities, retaining the source
references and conditions needed to interpret it. It represents a source claim,
including any stated temporal scope or planned status, rather than independent
verification of that claim.

**Source reference**:
A reference to an original passage in a specific source version that lets
readers or the system trace Wiki content and graph relationships to their
underlying evidence.

**Source activation**:
The point at which a prepared document version becomes the effective version
for current retrieval and knowledge maintenance. Activation of one document
does not by itself establish that its claims supersede a different source.

**Knowledge maintenance**:
The upkeep of source-grounded Wiki topics, entity identities, and graph
relationships as source material and user contributions change.

**Knowledge Agent**:
The conversational actor that interprets a member's request and selects knowledge
operations or follow-up evidence retrieval within a bounded run. Its conversation
history supports interaction and is not an independent knowledge source.

**Organization**:
The enterprise or team whose knowledge is maintained and used internally in the
first version. Its knowledge includes organization-level material and material
related to multiple projects.

**Knowledge run**:
A bounded attempt to handle a member's or external Agent's knowledge request,
including its answer or clarification outcome. Its response can end before
started work has finished settling.

**Knowledge operation**:
An identifiable requested change to sources or maintained knowledge with a
durable outcome. Its effects remain inspectable independently of the conversation
that requested it.

**Execution settlement**:
The point at which a knowledge run's started model, tool and persistence work
has finished or confirmed termination, so it no longer holds execution ownership.

**Organizational knowledge base**:
The organization's unified logical collection of source material and organized
knowledge, classified by organization-wide or project-specific affiliation.
Project classification supports scoped retrieval and cross-project connections;
it does not by itself grant access.
