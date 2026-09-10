# Identity proof validity and source-change propagation

Status: design defaults selected on 2026-09-10. M03 owns this policy behind its
existing identity resolution/validation interface; no new public module is added.

## I01: Proof records

Keep source mentions independently addressable. An identity binding records the
mention, canonical entity, resolution revision, applicability and a proof manifest.
Proof leaves are immutable source-version/passage references supporting reliable
identifiers or explicit equivalence. A compound proof references other resolution
records and includes their leaf-source closure; proof references form an acyclic
graph. Equality from name similarity or generated Wiki/graph prose is not a leaf.

For a chain A=B and B=C, any use of A=C must carry a valid witness path. Store
alternative proof sets separately: all dependencies within a set must be valid;
an independent complete valid set may preserve the binding. Merely retaining the
same canonical ID or resolution revision does not prove current validity.

M03 validates current source leaves through M02 as well as resolution revisions.
A source change invalidates dependent proof sets immediately at lookup/admission,
even before the identity worker updates cached status. M04/M05 dependencies include
used binding/proof revisions, not just canonical entity IDs. M06 admission checks
this transitive validity. An invalid merged binding cannot group unrelated evidence
or seed graph traversal; original mentions can remain distinct unresolved candidates.
Unrelated identities and independently revalidated alternative proofs remain usable.

## I02: Reconciliation and scheduling

Source activation persists an identity-revalidation event in the same transaction
as activation and downstream maintenance registration. M03's reverse proof index
finds affected bindings, including proofs used indirectly by other bindings.
Enumerate all affected IDs in stable 20-record cursor batches; no Top-K loss.
Source activation performs no synchronous model reasoning and does not wait for it.

Re-evaluate each affected component from current original evidence. Outcomes are
confirmed (same or revised binding with current proof), unresolved, or corrected
split/reassignment. Preserve old proof records and source mentions historically.
Use reliable identifier/explicit-equivalence checks first; ambiguous semantic cases
receive at most two proposal and two separate support-review requests per bounded
20-mention subtask, including provider retries, under V01 support semantics, with
a 120-second claim deadline and 45-second request timeout. Each request includes
at most 8,000 original/context tokens and 2,000 output tokens, reduced to fit the
model; unresolved required context is an explicit gap, not evidence of equality.
Accept only explicitly
supported identity evidence; uncertain judgments stay unresolved.
Oversized proof/component work is checkpointed in structural batches; limits never
authorize dropping affected bindings or inventing an equivalence. Unresolved is a
valid reconciliation result, not permission to preserve an invalid old merge.

Commit the new binding revisions/outcome and affected Wiki/graph maintenance jobs
atomically, checking expected proof-source revisions and worker fencing. A delayed
reconciliation cannot reactivate a proof whose sources changed again. Explicit user
identity corrections use the same path, with attributed supporting evidence.
Keep consumers ineligible until they revalidate their own new dependencies.

If source A was the only proof that two services are identical, replacing A with
a revision that removes that proof suspends the merged binding immediately, even
when relation sources B and C are unchanged. Reconciliation may keep the services
separate; it must not migrate B's facts to C by the old canonical grouping. Unknown
identity remains a stated evidence gap, not a definitive claim of inequality.

## I03: Completion and verification

#5/#7 provide durable activation events; #8 implements proof records, transitive
validation and reconciliation; #9/#12 consume binding validity; #16 checks recovery.
Use real source activation and proof fixtures for: withdrawn sole equivalence;
one surviving independent proof; A=B=C with the middle proof invalidated; same-name
unresolved mentions; delayed reconciliation after a second source update; and worker
replacement midway through a component. Prove invalid equivalence stops affecting
answers before asynchronous rebuild, without requiring the user to issue a correction.
