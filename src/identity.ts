import { sourceIdentifier, explicitEquivalence } from "./identity-evidence.ts";
import { AccessService } from "./access.ts";
import { hash } from "./answer-validation.ts";
import { Operations, type Transaction } from "./operations.ts";
import { SourceService } from "./sources.ts";
export interface ProofSource {
  version: string;
  passageId: string;
}
export interface IdentityProof {
  id: string;
  kind: string;
  explanation: string;
  valid: boolean;
  sources: ProofSource[];
  bindings: Array<{ mentionId: string; revisionId: string }>;
}
export interface IdentityWitness {
  kind: "equivalence" | "identifier";
  sources: ProofSource[];
}
export interface IdentityBinding {
  affected: string[];
  valid: boolean;
  proofs: IdentityProof[];
  id: string;
  canonicalId: string;
  revisionId: string;
  revision: number;
  outcome: "distinct" | "confirmed" | "unresolved";
  mention: {
    version: string;
    passageId: string;
    start: number;
    end: number;
    text: string;
  };
}
/** Mention identity is independent of a name, filename, or derived graph node. */
export class IdentityService {
  private readonly operations: Operations;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly sources: SourceService,
  ) {
    this.operations = new Operations(url);
  }
  async record(
    token: string,
    input: {
      version: string;
      passageId: string;
      label: string;
      occurrence?: number;
    },
  ): Promise<IdentityBinding> {
    const context = await this.access.authorize(token, "correct");
    const passage = await this.sources.resolve(
      token,
      input.version,
      input.passageId,
    );
    if (
      !input.label.trim() ||
      input.label.length > 160 ||
      !Number.isInteger(input.occurrence ?? 0) ||
      (input.occurrence ?? 0) < 0
    )
      throw new Error("invalid_input");
    let start = -1;
    for (let index = 0; index <= (input.occurrence ?? 0); index++) {
      start = passage.text.indexOf(input.label, start + 1);
      if (start < 0) throw new Error("invalid_input");
    }
    const end = start + input.label.length;
    const id = await this.operations.sql.begin(async (tx) => {
      const [source] =
        await tx`SELECT d.id,d.project_id FROM source_documents d WHERE d.active_version_id=${input.version} AND d.organization_id=${context.organizationId} FOR SHARE`;
      if (!source) throw new Error("source_changed");
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.passageId}:${start}:${end}`},0))`;
      const [existing] =
        await tx`SELECT id FROM identity_mentions WHERE passage_id=${input.passageId} AND start_offset=${start} AND end_offset=${end}`;
      if (existing) return String(existing.id);
      const id = crypto.randomUUID(),
        canonical = crypto.randomUUID(),
        revision = crypto.randomUUID();
      await tx`INSERT INTO identity_entities(id,organization_id) VALUES(${canonical},${context.organizationId})`;
      await tx`INSERT INTO identity_mentions(id,organization_id,version_id,passage_id,start_offset,end_offset,original_text,own_entity_id) VALUES(${id},${context.organizationId},${input.version},${input.passageId},${start},${end},${input.label},${canonical})`;
      await tx`INSERT INTO identity_revisions(id,mention_id,canonical_id,revision,outcome,actor_id) VALUES(${revision},${id},${canonical},1,'distinct',${context.actorId})`;
      await this.proof(
        tx,
        revision,
        "mention",
        "Independently located original mention",
        [{ version: input.version, passageId: input.passageId }],
        [],
      );
      const identifier = sourceIdentifier(passage.text, input.label);
      if (identifier)
        await tx`INSERT INTO identity_identifiers(mention_id,namespace,scope,value) VALUES(${id},${identifier.namespace},${identifier.namespace === "repository-url" ? context.organizationId : `${context.organizationId}:${source.project_id ?? "shared"}`},${identifier.value})`;
      await tx`UPDATE identity_mentions SET current_revision_id=${revision} WHERE id=${id}`;
      return id;
    });
    const binding = await this.inspect(token, id);
    if (binding.outcome !== "distinct") return binding;
    const candidates = await this.operations
      .sql`SELECT DISTINCT m.id,m.current_revision_id,r.canonical_id,m.version_id,m.passage_id FROM identity_identifiers own JOIN identity_identifiers other ON other.namespace=own.namespace AND other.scope=own.scope AND other.value=own.value JOIN identity_mentions m ON m.id=other.mention_id JOIN identity_revisions r ON r.id=m.current_revision_id WHERE own.mention_id=${id} AND m.id<>${id} AND m.organization_id=${context.organizationId} AND EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid) ORDER BY m.id`;
    if (
      candidates.length &&
      new Set(candidates.map((item) => item.canonical_id)).size === 1
    ) {
      const target = candidates[0]!;
      return this.bind(token, {
        key: `identifier:${id}:${binding.revisionId}`,
        mentionId: id,
        targetId: String(target.id),
        expectedRevision: binding.revisionId,
        witnesses: [
          {
            kind: "identifier",
            sources: [
              binding.mention,
              {
                version: String(target.version_id),
                passageId: String(target.passage_id),
              },
            ],
          },
        ],
      });
    }
    return binding;
  }
  async inspect(
    token: string,
    id: string,
    revisionId?: string,
  ): Promise<IdentityBinding> {
    const context = await this.access.authorize(token, "read");
    const [row] = await this.operations
      .sql`SELECT m.*,r.id AS selected_revision_id,r.canonical_id,r.revision,r.outcome FROM identity_mentions m JOIN identity_revisions r ON r.mention_id=m.id AND r.id=COALESCE(${revisionId ?? null}::uuid,m.current_revision_id) WHERE m.id=${id} AND m.organization_id=${context.organizationId}`;
    if (!row) throw new Error("not_found");
    const proofs = await this.readProofs(String(row.selected_revision_id));
    const affected = await this.operations
      .sql`SELECT DISTINCT m.id FROM identity_mentions m WHERE m.organization_id=${context.organizationId} AND (m.id=${id} OR EXISTS(SELECT 1 FROM identity_proofs p JOIN identity_proof_bindings b ON b.proof_id=p.id WHERE p.revision_id=m.current_revision_id AND b.mention_id=${id})) ORDER BY m.id`;
    return {
      affected: affected.map((item) => String(item.id)),
      valid:
        row.outcome !== "unresolved" && proofs.some((proof) => proof.valid),
      proofs,
      id: String(row.id),
      canonicalId: String(row.canonical_id),
      revisionId: String(row.selected_revision_id),
      revision: Number(row.revision),
      outcome: row.outcome,
      mention: {
        version: String(row.version_id),
        passageId: String(row.passage_id),
        start: Number(row.start_offset),
        end: Number(row.end_offset),
        text: String(row.original_text),
      },
    };
  }
  async list(token: string, version: string, after = "") {
    const context = await this.access.authorize(token, "read");
    await this.sources.version(token, version);
    const rows = await this.operations
      .sql`SELECT m.id,m.original_text,r.outcome,r.revision,EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid) AS valid FROM identity_mentions m JOIN identity_revisions r ON r.id=m.current_revision_id WHERE m.version_id=${version} AND m.organization_id=${context.organizationId} AND m.id::text>${after} ORDER BY m.id LIMIT 21`;
    const items = rows.slice(0, 20).map((row) => ({
      id: String(row.id),
      text: String(row.original_text),
      outcome: String(row.outcome),
      revision: Number(row.revision),
      valid: Boolean(row.valid),
    }));
    return {
      items,
      ...(rows.length > 20 ? { nextCursor: items.at(-1)!.id } : {}),
    };
  }
  async validate(
    token: string,
    dependencies: Array<{
      mentionId: string;
      revisionId: string;
      proofId: string;
    }>,
  ) {
    const context = await this.access.authorize(token, "read");
    if (dependencies.length > 100) throw new Error("invalid_input");
    const rows = await this.operations
      .sql`SELECT ref.*,m.organization_id,m.current_revision_id,p.valid,statement_timestamp() AS checked_at FROM jsonb_to_recordset(${this.operations.sql.json(dependencies.map((ref) => ({ mention_id: ref.mentionId, revision_id: ref.revisionId, proof_id: ref.proofId })))}::jsonb) AS ref(mention_id uuid,revision_id uuid,proof_id uuid) LEFT JOIN identity_mentions m ON m.id=ref.mention_id AND m.organization_id=${context.organizationId} LEFT JOIN identity_proof_eligibility p ON p.id=ref.proof_id AND p.revision_id=ref.revision_id AND ref.revision_id=m.current_revision_id`;
    return {
      valid:
        rows.length === dependencies.length &&
        rows.every(
          (row) =>
            row.organization_id === context.organizationId &&
            row.current_revision_id === row.revision_id &&
            row.valid === true,
        ),
      checkedAt:
        rows[0]?.checked_at instanceof Date
          ? rows[0].checked_at.toISOString()
          : new Date().toISOString(),
    };
  }
  async assertForPublication(
    tx: Transaction,
    organizationId: string,
    dependencies: Array<{
      mentionId: string;
      revisionId: string;
      proofId: string;
    }>,
  ): Promise<string[]> {
    if (!dependencies.length) return [];
    if (dependencies.length > 100)
      throw new Error("invalid_identity_dependencies");
    const proofIds = dependencies.map((ref) => ref.proofId);
    await tx`SELECT d.id FROM source_documents d WHERE d.id IN (SELECT v.document_id FROM identity_proof_leaves l JOIN source_versions v ON v.id=l.version_id WHERE l.proof_id IN ${tx(proofIds)}) ORDER BY d.id FOR SHARE`;
    await tx`SELECT m.id FROM identity_mentions m WHERE m.id IN ${tx(dependencies.map((ref) => ref.mentionId))} OR m.id IN (SELECT b.mention_id FROM identity_proof_bindings b WHERE b.proof_id IN ${tx(proofIds)}) ORDER BY m.id FOR SHARE`;
    const rows =
      await tx`SELECT ref.*,r.canonical_id FROM jsonb_to_recordset(${tx.json(dependencies.map((ref) => ({ mention: ref.mentionId, revision: ref.revisionId, proof: ref.proofId })))}::jsonb) ref(mention uuid,revision uuid,proof uuid) JOIN identity_mentions m ON m.id=ref.mention AND m.organization_id=${organizationId} AND m.current_revision_id=ref.revision JOIN identity_revisions r ON r.id=ref.revision JOIN identity_proof_eligibility p ON p.id=ref.proof AND p.revision_id=r.id AND p.valid`;
    if (rows.length !== dependencies.length)
      throw new Error("identity_changed");
    return [...new Set(rows.map((row) => String(row.canonical_id)))];
  }
  async maintenanceDependencies(operationId: string, mentionIds: string[]) {
    if (!mentionIds.length) return [];
    if (mentionIds.length > 100)
      throw new Error("invalid_identity_dependencies");
    const rows = await this.operations
      .sql`SELECT DISTINCT ON(m.id) m.id,m.current_revision_id,p.id AS proof_id FROM identity_mentions m JOIN knowledge_operations o ON o.organization_id=m.organization_id AND o.id=${operationId} JOIN identity_proof_eligibility p ON p.revision_id=m.current_revision_id AND p.valid WHERE m.id IN ${this.operations.sql(mentionIds)} ORDER BY m.id,p.id`;
    if (rows.length !== new Set(mentionIds).size)
      throw new Error("needs_attention:unresolved_identity");
    return rows.map((row) => ({
      mentionId: String(row.id),
      revisionId: String(row.current_revision_id),
      proofId: String(row.proof_id),
    }));
  }
  async history(token: string, mentionId: string) {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT r.id,r.revision,r.canonical_id,r.outcome,r.created_at FROM identity_revisions r JOIN identity_mentions m ON m.id=r.mention_id WHERE m.id=${mentionId} AND m.organization_id=${context.organizationId} ORDER BY r.revision`;
    if (!rows.length) throw new Error("not_found");
    return rows.map((row) => ({
      revisionId: String(row.id),
      revision: Number(row.revision),
      canonicalId: String(row.canonical_id),
      outcome: String(row.outcome),
      createdAt: row.created_at,
    }));
  }
  async bind(
    token: string,
    input: {
      key: string;
      mentionId: string;
      targetId: string;
      expectedRevision: string;
      witnesses: IdentityWitness[];
    },
  ): Promise<IdentityBinding> {
    const context = await this.access.authorize(token, "correct");
    if (
      input.mentionId === input.targetId ||
      !input.witnesses.length ||
      input.witnesses.length > 20
    )
      throw new Error("invalid_input");
    const previousOperation = await this.operations.lookup(
      context,
      input.key,
      hash(input),
    );
    if (previousOperation) {
      const [revision] = await this.operations
        .sql`SELECT id FROM identity_revisions WHERE operation_id=${previousOperation} AND mention_id=${input.mentionId}`;
      if (!revision) throw new Error("version_conflict");
      return this.inspect(token, input.mentionId, String(revision.id));
    }
    // Immutable locators and proof contents are validated before any accepted mutation.
    const from = await this.inspect(token, input.mentionId),
      target = await this.inspect(token, input.targetId);
    if (!target.valid) throw new Error("identity_unresolved");
    const witnesses: Array<{
      sources: ProofSource[];
      bindings: IdentityProof["bindings"];
      explanation: string;
      kind: string;
    }> = [];
    for (const witness of input.witnesses) {
      let explanation: string;
      if (witness.kind === "equivalence" && witness.sources.length === 1) {
        const source = witness.sources[0]!;
        const passage = await this.sources.resolve(
          token,
          source.version,
          source.passageId,
        );
        if (
          from.mention.text === target.mention.text ||
          !explicitEquivalence(
            passage.text,
            from.mention.text,
            target.mention.text,
          )
        )
          throw new Error("insufficient_evidence");
        const labels = await this.operations
          .sql`SELECT m.original_text,count(DISTINCT r.canonical_id) AS identities FROM identity_mentions m JOIN identity_revisions r ON r.id=m.current_revision_id JOIN source_documents d ON d.active_version_id=m.version_id WHERE m.organization_id=${context.organizationId} AND m.original_text IN ${this.operations.sql([from.mention.text, target.mention.text])} GROUP BY m.original_text`;
        if (labels.some((row) => Number(row.identities) > 1))
          throw new Error("identity_unresolved");
        explanation = passage.text;
      } else if (
        witness.kind === "identifier" &&
        witness.sources.length === 2
      ) {
        const expected = uniqueSources([from.mention, target.mention]);
        if (
          hash(
            uniqueSources(witness.sources).sort((a, b) =>
              a.passageId.localeCompare(b.passageId),
            ),
          ) !==
          hash(expected.sort((a, b) => a.passageId.localeCompare(b.passageId)))
        )
          throw new Error("invalid_input");
        const rows = await this.operations
          .sql`SELECT own.namespace,own.scope,own.value FROM identity_identifiers own JOIN identity_identifiers other ON own.namespace=other.namespace AND own.scope=other.scope AND own.value=other.value WHERE own.mention_id=${from.id} AND other.mention_id=${target.id}`;
        if (!rows.length) throw new Error("insufficient_evidence");
        explanation = `Matching source identifier ${String(rows[0]!.namespace)}=${String(rows[0]!.value)} in scope ${String(rows[0]!.scope)}`;
      } else throw new Error("invalid_input");
      for (const parent of target.proofs.filter((proof) => proof.valid)) {
        const bindings = [
          { mentionId: target.id, revisionId: target.revisionId },
          ...parent.bindings,
        ];
        if (bindings.some((binding) => binding.mentionId === from.id))
          throw new Error("identity_cycle");
        witnesses.push({
          sources: uniqueSources([
            from.mention,
            ...witness.sources,
            ...parent.sources,
          ]),
          bindings,
          explanation,
          kind: witness.kind,
        });
      }
    }
    await this.operations.accept(
      context,
      input.key,
      hash(input),
      async (tx, operationId) => {
        const allSources = uniqueSources(
          witnesses.flatMap((witness) => witness.sources),
        );
        const versions = allSources.map((source) => source.version);
        const documents =
          await tx`SELECT d.active_version_id FROM source_documents d WHERE d.id IN (SELECT document_id FROM source_versions WHERE id IN ${tx(versions)}) ORDER BY d.id FOR SHARE`;
        if (
          versions.some(
            (version) =>
              !documents.some((row) => row.active_version_id === version),
          )
        )
          throw new Error("source_changed");
        const dependencies = witnesses.flatMap((witness) => witness.bindings);
        const mentions =
          await tx`SELECT id,current_revision_id FROM identity_mentions WHERE id IN ${tx([from.id, ...dependencies.map((binding) => binding.mentionId)])} ORDER BY id FOR UPDATE`;
        if (
          mentions.find((mention) => mention.id === from.id)
            ?.current_revision_id !== input.expectedRevision ||
          dependencies.some(
            (binding) =>
              mentions.find((mention) => mention.id === binding.mentionId)
                ?.current_revision_id !== binding.revisionId,
          )
        )
          throw new Error("version_conflict");
        const revisionId = crypto.randomUUID();
        await tx`INSERT INTO identity_revisions(id,mention_id,canonical_id,revision,outcome,actor_id,operation_id) VALUES(${revisionId},${from.id},${target.canonicalId},${from.revision + 1},'confirmed',${context.actorId},${operationId})`;
        for (const witness of witnesses)
          await this.proof(
            tx,
            revisionId,
            witness.kind,
            witness.explanation,
            witness.sources,
            witness.bindings,
          );
        await tx`UPDATE identity_mentions SET current_revision_id=${revisionId} WHERE id=${from.id}`;
        await this.operations.enqueue(tx, operationId, "identity.revalidate", {
          mentionId: from.id,
          revisionId,
          previousRevisionId: from.revisionId,
        });
        for (const kind of ["wiki.identity", "graph.identity"])
          await this.operations.enqueue(tx, operationId, kind, {
            mentionId: from.id,
            previousRevisionId: from.revisionId,
            revisionId,
          });
      },
    );
    return this.inspect(token, from.id);
  }
  private async proof(
    tx: Transaction,
    revisionId: string,
    kind: string,
    explanation: string,
    sources: ProofSource[],
    bindings: IdentityProof["bindings"],
  ) {
    const id = crypto.randomUUID();
    await tx`INSERT INTO identity_proofs(id,revision_id,kind,explanation) VALUES(${id},${revisionId},${kind},${explanation})`;
    for (const source of uniqueSources(sources))
      await tx`INSERT INTO identity_proof_leaves(proof_id,version_id,passage_id) VALUES(${id},${source.version},${source.passageId})`;
    for (const binding of new Map(
      bindings.map((item) => [item.mentionId, item]),
    ).values())
      await tx`INSERT INTO identity_proof_bindings(proof_id,mention_id,revision_id) VALUES(${id},${binding.mentionId},${binding.revisionId})`;
  }
  private async readProofs(
    revisionId: string,
    sql: Transaction | typeof this.operations.sql = this.operations.sql,
  ): Promise<IdentityProof[]> {
    const rows =
      await sql`SELECT p.*,(p.valid AND owner.current_revision_id=p.revision_id) AS valid,COALESCE((SELECT jsonb_agg(jsonb_build_object('version',l.version_id,'passageId',l.passage_id)) FROM identity_proof_leaves l WHERE l.proof_id=p.id),'[]') AS sources,COALESCE((SELECT jsonb_agg(jsonb_build_object('mentionId',b.mention_id,'revisionId',b.revision_id)) FROM identity_proof_bindings b WHERE b.proof_id=p.id),'[]') AS bindings FROM identity_proof_eligibility p JOIN identity_revisions revision ON revision.id=p.revision_id JOIN identity_mentions owner ON owner.id=revision.mention_id WHERE p.revision_id=${revisionId}`;
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      explanation: String(row.explanation),
      valid: Boolean(row.valid),
      sources: row.sources,
      bindings: row.bindings,
    }));
  }
  private async revalidateExactProof(
    tx: Transaction,
    mention: Record<string, unknown>,
  ): Promise<{ canonicalId: string; proofs: IdentityProof[] } | undefined> {
    const [own] =
      await tx`SELECT id FROM source_documents WHERE active_version_id=${String(mention.version_id)} FOR SHARE`;
    if (!own) return undefined;
    const recipes =
      await tx`SELECT p.* FROM identity_proofs p WHERE p.revision_id=(SELECT id FROM identity_revisions WHERE mention_id=${String(mention.id)} AND outcome='confirmed' ORDER BY revision DESC LIMIT 1) AND p.kind='equivalence'`;
    const plans: Array<{ canonicalId: string; proof: IdentityProof }> = [];
    for (const recipe of recipes) {
      const targets =
        await tx`SELECT m.*,r.canonical_id FROM identity_proof_bindings b JOIN identity_mentions m ON m.id=b.mention_id JOIN identity_revisions r ON r.id=m.current_revision_id WHERE b.proof_id=${String(recipe.id)} FOR SHARE OF m`;
      const target = targets.find((candidate) =>
        explicitEquivalence(
          String(recipe.explanation),
          String(mention.original_text),
          String(candidate.original_text),
        ),
      );
      if (!target) continue;
      const original =
        await tx`SELECT DISTINCT current.id,current.version_id FROM identity_proof_leaves l JOIN source_passages old ON old.id=l.passage_id JOIN source_versions v ON v.id=l.version_id JOIN source_documents d ON d.id=v.document_id JOIN source_passages current ON current.version_id=d.active_version_id WHERE l.proof_id=${String(recipe.id)} AND old.original_text=${String(recipe.explanation)} AND btrim(current.original_text,E' \t\r\n')=btrim(old.original_text,E' \t\r\n')`;
      if (!original.length) continue;
      for (const parent of (
        await this.readProofs(String(target.current_revision_id), tx)
      ).filter((proof) => proof.valid)) {
        if (
          parent.bindings.some((binding) => binding.mentionId === mention.id) ||
          target.id === mention.id
        )
          continue;
        for (const leaf of original) {
          const sources = uniqueSources([
            {
              version: String(mention.version_id),
              passageId: String(mention.passage_id),
            },
            { version: String(leaf.version_id), passageId: String(leaf.id) },
            ...parent.sources,
          ]);
          const versions = sources.map((source) => source.version);
          const documents =
            await tx`SELECT active_version_id FROM source_documents WHERE id IN (SELECT document_id FROM source_versions WHERE id IN ${tx(versions)}) ORDER BY id FOR SHARE`;
          if (
            versions.some(
              (version) =>
                !documents.some(
                  (document) => document.active_version_id === version,
                ),
            )
          )
            continue;
          const dependencies = [
            {
              mentionId: String(target.id),
              revisionId: String(target.current_revision_id),
            },
            ...parent.bindings,
          ];
          const bindings =
            await tx`SELECT id,current_revision_id FROM identity_mentions WHERE id IN ${tx(dependencies.map((binding) => binding.mentionId))} ORDER BY id FOR SHARE`;
          if (
            dependencies.some(
              (dependency) =>
                !bindings.some(
                  (binding) =>
                    binding.id === dependency.mentionId &&
                    binding.current_revision_id === dependency.revisionId,
                ),
            )
          )
            continue;
          plans.push({
            canonicalId: String(target.canonical_id),
            proof: {
              id: "",
              kind: "equivalence",
              explanation: String(recipe.explanation),
              valid: true,
              sources,
              bindings: dependencies,
            },
          });
        }
      }
    }
    if (
      !plans.length ||
      new Set(plans.map((plan) => plan.canonicalId)).size !== 1
    )
      return undefined;
    return {
      canonicalId: plans[0]!.canonicalId,
      proofs: plans.map((plan) => plan.proof),
    };
  }
  async workOne(
    token?: string,
  ): Promise<
    { operationId: string; processed: number; complete: boolean } | undefined
  > {
    const context = token
      ? await this.access.authorize(token, "correct")
      : undefined;
    const job = await this.operations.claim(
      ["identity.revalidate"],
      120000,
      context?.organizationId,
    );
    if (!job) return undefined;
    const changedBinding =
      typeof job.payload.mentionId === "string"
        ? job.payload.mentionId
        : undefined;
    const previous =
      typeof job.payload.previousVersionId === "string"
        ? job.payload.previousVersionId
        : undefined;
    if (!previous && !changedBinding) {
      await this.operations.commit(job, async () => {});
      return { operationId: job.operationId, processed: 0, complete: true };
    }
    const cursor =
      typeof job.payload.cursor === "string" ? job.payload.cursor : "";
    const rows = changedBinding
      ? await this.operations
          .sql`SELECT DISTINCT m.id,m.current_revision_id FROM identity_mentions m JOIN identity_revisions history ON history.mention_id=m.id JOIN identity_proofs p ON p.revision_id=history.id JOIN identity_proof_bindings b ON b.proof_id=p.id WHERE b.mention_id=${changedBinding} AND b.revision_id<>${String(job.payload.revisionId)} AND m.id::text>${cursor} ORDER BY m.id LIMIT 21`
      : await this.operations
          .sql`SELECT DISTINCT m.id,m.current_revision_id FROM identity_mentions m JOIN identity_revisions history ON history.mention_id=m.id JOIN identity_proofs p ON p.revision_id=history.id JOIN identity_proof_leaves l ON l.proof_id=p.id WHERE l.version_id IN (SELECT id FROM source_versions WHERE document_id=${String(job.payload.documentId)} AND id<>${String(job.payload.versionId)}) AND m.id::text>${cursor} ORDER BY m.id LIMIT 21`;
    const batch = rows.slice(0, 20);
    let complete = rows.length <= 20;
    const pass = Number(job.payload.pass ?? 0);
    let confirmedInPass = job.payload.confirmedInPass === true;
    let unresolvedInPass = job.payload.unresolvedInPass === true;
    try {
      await this.operations.commit(
        job,
        async (tx) => {
          if (changedBinding) {
            const [binding] =
              await tx`SELECT current_revision_id FROM identity_mentions WHERE id=${changedBinding} FOR SHARE`;
            if (binding?.current_revision_id !== job.payload.revisionId)
              throw new Error("identity_changed_again");
          } else {
            const [document] =
              await tx`SELECT active_version_id FROM source_documents WHERE id=${String(job.payload.documentId)} FOR SHARE`;
            if (document?.active_version_id !== job.payload.versionId)
              throw new Error("source_changed_again");
          }
          await tx`INSERT INTO identity_revalidation_batches(job_id,cursor,mention_ids,state) VALUES(${job.id},${`${pass}:${cursor}`},${tx.json(batch.map((item) => String(item.id)))},'complete') ON CONFLICT(job_id,cursor) DO NOTHING`;
          const changed: string[] = [];
          for (const item of batch) {
            const [mention] =
              await tx`SELECT m.*,r.revision,r.outcome FROM identity_mentions m JOIN identity_revisions r ON r.id=m.current_revision_id WHERE m.id=${String(item.id)} FOR UPDATE OF m`;
            if (
              !mention ||
              mention.current_revision_id !== item.current_revision_id
            )
              continue;
            const [valid] =
              await tx`SELECT id FROM identity_proof_eligibility WHERE revision_id=${String(mention.current_revision_id)} AND valid LIMIT 1`;
            if (valid) continue;
            const refreshed = await this.revalidateExactProof(tx, mention);
            if (refreshed) confirmedInPass = true;
            else unresolvedInPass = true;
            if (!refreshed && mention.outcome === "unresolved") continue;
            const revisionId = crypto.randomUUID();
            await tx`INSERT INTO identity_revisions(id,mention_id,canonical_id,revision,outcome,operation_id) VALUES(${revisionId},${String(mention.id)},${refreshed?.canonicalId ?? String(mention.own_entity_id)},${Number(mention.revision) + 1},${refreshed ? "confirmed" : "unresolved"},${job.operationId})`;
            if (refreshed)
              for (const proof of refreshed.proofs)
                await this.proof(
                  tx,
                  revisionId,
                  proof.kind,
                  proof.explanation,
                  proof.sources,
                  proof.bindings,
                );
            await tx`UPDATE identity_mentions SET current_revision_id=${revisionId} WHERE id=${String(mention.id)}`;
            changed.push(String(mention.id));
          }
          if (changed.length)
            for (const kind of ["wiki.identity", "graph.identity"])
              await this.operations.enqueue(
                tx,
                job.operationId,
                kind,
                {
                  mentionIds: changed,
                  ...(changedBinding
                    ? { bindingRevisionId: job.payload.revisionId }
                    : { sourceVersionId: job.payload.versionId }),
                },
                `${job.id}:${pass}:${cursor}`,
              );
          if (complete && confirmedInPass && unresolvedInPass) {
            // A parent fixed later in the stable scan can now support an earlier child.
            // No model allowance is renewed by this structural follow-up pass.
            complete = false;
            await tx`UPDATE knowledge_jobs SET payload=payload||${tx.json({ cursor: "", pass: pass + 1, confirmedInPass: false, unresolvedInPass: false })}::jsonb WHERE id=${job.id}`;
          } else if (!complete) {
            await tx`UPDATE knowledge_jobs SET payload=payload||${tx.json({ cursor: String(batch.at(-1)!.id), pass, confirmedInPass, unresolvedInPass })}::jsonb WHERE id=${job.id}`;
          }
          return complete ? "succeeded" : "queued";
        },
        complete ? "succeeded" : "queued",
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["source_changed_again", "identity_changed_again"].includes(
          error.message,
        )
      )
        throw error;
      await this.operations.commit(
        job,
        async (tx) => {
          await tx`UPDATE knowledge_jobs SET reason=${error.message} WHERE id=${job.id}`;
        },
        "superseded",
      );
      return { operationId: job.operationId, processed: 0, complete: true };
    }
    return { operationId: job.operationId, processed: batch.length, complete };
  }
  async close() {
    await this.operations.close();
  }
}

function uniqueSources(sources: ProofSource[]): ProofSource[] {
  return [
    ...new Map(
      sources.map((source) => [
        `${source.version}:${source.passageId}`,
        { version: source.version, passageId: source.passageId },
      ]),
    ).values(),
  ];
}
