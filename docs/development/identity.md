# Identity runtime boundary

M03 keeps independently located mentions, canonical entities, monotonic binding
revisions, scoped reliable identifiers and immutable proof witnesses. It can be
used before graph extraction. The source page lets a member record an exact
mention by paragraph/name/occurrence and inspect its original-backed explanation.
The HTTP binding command accepts selected mentions, expected prior binding revision,
operation key and original proof locators. It preserves prior mention/proof history
and queues Wiki/graph invalidation in the same transaction.

## Current deterministic evidence checks

The scripted bootstrap recognizes these entire original-paragraph forms:

- `“B”与“A”指同一实体。`
- `"B" and "A" refer to the same entity.`
- `“Alpha”的service-id为“svc-123”。`
- `“Alpha”的repository-url为“https://example.com/team/repo”。`

Names must match selected original mentions. Identical names and ambiguous names
are not equivalence evidence. Service identifiers are organization/project scoped;
shared and project-local identifiers do not match merely by value. Repository URLs
use organization scope and require HTTPS without credentials, query or fragment.
Equal identifiers in applicable scopes can resolve automatically; general prose,
semantic similarity, and speculative interpretations remain unresolved.

These conservative checks are deterministic, not a general semantic identity model.
No proposal/review model requests are dispatched by the current identity bootstrap;
batch admission records therefore retain zero proposal/review counts. The I02
ceilings remain two proposals/two reviews per 20-mention subtask, 120 seconds and
45 seconds per model request if a semantic adapter is added. The current checks
must not be described as real-model extraction or broad semantic coverage.

## Proof and update behavior

Each witness retains original version/passage leaves and the complete selected
binding-revision closure. Alternative witnesses remain separate. Read/admission
checks require current original leaves AND unchanged binding dependencies; any
complete eligible alternative can preserve the identity. A canonical ID alone is
never sufficient. Immutable old proofs remain inspectable after correction.

Activation and binding-correction jobs enumerate affected mentions using reverse leaf/binding indexes, including
all prior versions of the changed document. This also catches dependencies missed
by an older event superseded by a second update. Each transaction processes at most
20 mention records and stores its cursor with the result. Changes and downstream
Wiki/graph jobs commit under the same worker fence. Identical explicit evidence in
a replacement original can be mechanically revalidated; otherwise unresolved
mentions remain separate. If a parent was repaired later in the scan, a persisted
structural follow-up pass revisits earlier children without model budget renewal.
Binding corrections register their M03 revalidation event in the same transaction, so unchanged-source descendants can follow a corrected parent without waiting for source activation. Repeated jobs do not recreate an unchanged unresolved revision.

An event for a no-longer-current activation settles as superseded. Both start and
end of a durable commit check the lease/fence. Old in-flight workers cannot publish
after ownership replacement. Identity bindings themselves also check expected
prior revisions and source pointers inside their publication transaction.

## HTTP commands and queries

All routes use the authenticated organization and existing read/correct grants:

| Route | Behavior |
| --- | --- |
| `GET /api/sources/:version/identities?after=...` | Stable 20-record mention pages, with current eligibility |
| `POST /api/sources/:version/identities` | Record `passageId`, exact `label`, optional zero-based `occurrence` |
| `GET /api/identities/:id` | Binding revision, original mention, proof alternatives and affected dependents |
| `GET /api/identities/:id/history` | Immutable revision metadata |
| `POST /api/identities/bind` | Evidenced reassignment with `key`, `mentionId`, `targetId`, `expectedRevision`, `witnesses` |

Witnesses contain `kind` (`equivalence` or `identifier`) and `sources`, each with
`version` and `passageId`. Equivalent assertions have one direct source; identifier
proofs reference both selected mentions' original paragraphs. The domain validation
interface consumes mention/binding/proof IDs, never a canonical ID alone.

The tests use real PostgreSQL source activation and public source/identity/operation
interfaces, plus a browser explanation flow. They establish provenance, transaction
and fail-closed behavior; they do not establish semantic model quality. Natural
language correction orchestration belongs to #11; graph joining and answer identity
admission are integrated by #12/#13.
