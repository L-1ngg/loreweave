# Conversations

Conversations retain questions, answers, run outcomes and their document scope on
the server. Open or create a conversation, choose the scope and submit a question.

## Scope and evidence

Library scope lets the assistant discover relevant current documents. Selected
scope limits reads to the chosen documents; each selected document must still be
available. An unavailable selection produces an explicit error rather than
broadening the question to the library. Ambiguous requests can ask you to clarify.

The assistant uses document metadata, trees and summaries for navigation, then
reads original pages to support facts. Follow-ups use conversation context but
require fresh original support for new factual conclusions. Missing support is
reported as an evidence gap; conflicting originals keep their separate sources
and qualifications.

Click a citation to inspect its immutable PDF version and physical page. Desktop
shows the original beside the answer. Mobile opens it separately and returns to
the originating conversation position. Printed page labels do not change the
citation target. Later document updates and removal from the current library do
not redirect historical citations to different bytes.

## Reconnect and Stop

After the server accepts a question, its run continues while you refresh, navigate
or close the browser. Reopening the conversation reconnects to that saved run;
observation does not submit a second question or repeat the model call.

Use **Stop** to cancel accepted execution. A lost viewer connection is only a
detachment. Local cancellation stops further application work; provider-side
computation and billing termination depend on the endpoint's behavior.

If the application process restarts, unfinished work becomes `interrupted`.
Committed history remains visible, with no automatic model replay. Deliberately
resending a failed or interrupted question creates new work and can incur a new
provider charge. The previous outcome remains in history.

## Manage history

Create, select, rename and delete conversations. One conversation permits one
active accepted question. Deletion is refused while its run is active; Stop and
wait for a terminal outcome first. Deleting a conversation does not remove library
documents or their originals. Message editing, branching and completed-answer
regeneration are outside the current scope.
