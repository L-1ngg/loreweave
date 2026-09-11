import { GraphQueries } from "./graph-queries.ts";
import {
  graphOriginals,
  graphPackets,
  type GraphOriginal,
} from "./graph-packets.ts";
import { AccessService } from "./access.ts";
import { hash, record } from "./answer-validation.ts";
import { IdentityService } from "./identity.ts";
import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import { SourceService } from "./sources.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import { BackgroundAdmission } from "./background-admission.ts";
import type {
  GraphClaimView,
  GraphModel,
  GraphPacketResult,
  GraphRelation,
} from "./graph-types.ts";

const predicates = new Set([
  "responsibility",
  "membership",
  "ownership",
  "part_of",
  "dependency",
  "usage",
  "applicability",
]);
const normalizationProfile = "graph-normalization-v1";
const relationMapping = {
  predicate: new Map<string, string>([
    ["depends_on", "dependency"],
    ["dependency", "dependency"],
  ]),
  direction: new Map<string, "forward" | "reverse">([
    ["forward", "forward"],
    ["reverse", "reverse"],
  ]),
} as const;
function normalizeRelation(relation: GraphRelation) {
  const predicate =
    relationMapping.predicate.get(relation.predicate.trim().toLowerCase()) ??
    relation.predicate.trim().toLowerCase();
  return {
    ...relation,
    predicate,
    direction: relationMapping.direction.get(relation.direction) ?? "forward",
    scope: relation.scope.trim() || "source",
    qualifiers: { ...relation.qualifiers },
  };
}
export class GraphService {
  private readonly operations: Operations;
  private readonly runtime: WikiModelRuntime;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly sources: SourceService,
    private readonly identities: IdentityService,
    private readonly model: GraphModel,
  ) {
    this.operations = new Operations(url);
    this.runtime = new WikiModelRuntime(
      this.operations,
      model,
      new BackgroundAdmission(url),
    );
  }
  private profile() {
    return `graph-v3:${this.model.profile}:${normalizationProfile}:vocabulary-v1`;
  }
  async workOne(token?: string) {
    const context = token
      ? await this.access.authorize(token, "import")
      : undefined;
    const job = await this.operations.claim(
      ["graph.refresh", "graph.identity"],
      120000,
      context?.organizationId,
    );
    if (!job) return false;
    try {
      await this.run(job);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "graph_failed";
      await this.operations.commit(
        job,
        async (tx) => {
          await tx`UPDATE knowledge_jobs SET reason=${reason} WHERE id=${job.id}`;
          if (reason === "identity_changed" && !job.payload.identityRetry) {
            await this.operations.enqueue(
              tx,
              job.operationId,
              "graph.refresh",
              { ...job.payload, identityRetry: true },
              `${job.id}:identity-retry`,
            );
          }
          await tx`UPDATE graph_generations SET state=${reason.startsWith("source_changed") || reason.startsWith("identity_changed") ? "superseded" : "failed"},coverage=coverage||${tx.json({ failure: reason })}::jsonb WHERE trigger_job_id=${job.id} AND state='staged'`;
          await tx`UPDATE graph_packets SET state='failed',error=${reason} WHERE generation_id IN(SELECT id FROM graph_generations WHERE trigger_job_id=${job.id}) AND state='pending'`;
        },
        reason.startsWith("source_changed") ||
          reason.startsWith("identity_changed")
          ? "superseded"
          : "failed",
      );
      return true;
    }
  }
  private async sourcePack(job: Job, versionId: string) {
    const source = await this.sources.maintenanceVersion(
      job.operationId,
      versionId,
    );
    const items = graphOriginals(source);
    return { source, items, hash: hash(items) };
  }
  private async run(job: Job) {
    const [owner] = await this.operations
      .sql`SELECT organization_id FROM knowledge_operations WHERE id=${job.operationId}`;
    const org = String(owner!.organization_id);
    if (job.kind === "graph.identity") {
      const mentions = (job.payload.mentionIds ??
        (job.payload.mentionId ? [job.payload.mentionId] : [])) as string[];
      const versions = await this.operations
        .sql`SELECT DISTINCT d.active_version_id AS id FROM source_documents d
        WHERE d.organization_id=${org} AND d.active_version_id IS NOT NULL AND (
          EXISTS(SELECT 1 FROM identity_mentions m WHERE m.version_id=d.active_version_id AND m.id::text IN ${this.operations.sql(mentions.length ? mentions : [""])}) OR
          EXISTS(SELECT 1 FROM graph_supports support JOIN graph_generations g ON g.id=support.generation_id, jsonb_to_recordset(support.identity_dependencies) dep(mention_id text)
            WHERE g.document_id=d.id AND dep.mention_id IN ${this.operations.sql(mentions.length ? mentions : [""])} ) OR
          EXISTS(SELECT 1 FROM graph_packets p JOIN graph_generations g ON g.id=p.generation_id,
            jsonb_array_elements_text(p.endpoint_mentions) endpoint
            WHERE g.source_version_id=d.active_version_id AND g.state IN('active','staged','failed')
              AND endpoint.value IN ${this.operations.sql(mentions.length ? mentions : [""])})) ORDER BY d.active_version_id`;
      await this.operations.commit(job, async (tx) => {
        for (const version of versions)
          await this.operations.enqueue(
            tx,
            job.operationId,
            "graph.refresh",
            { versionId: String(version.id), identityReplacement: true },
            `${job.id}:${String(version.id)}`,
          );
      });
      return;
    }
    const versionId = String(job.payload.versionId ?? "");
    const pack = await this.sourcePack(job, versionId);
    const identitySnapshot = await this.operations
      .sql`SELECT m.id,m.current_revision_id FROM identity_mentions m WHERE m.version_id=${versionId} ORDER BY m.id`;
    // A compact monotonic revision snapshot catches identity events consumed while
    // the model is still discovering previously unknown cross-source endpoints.
    const epoch = async (tx: Transaction) => {
      const [row] =
        await tx`SELECT count(*)::text AS mentions,COALESCE(sum(r.revision),0)::text AS revisions
        FROM identity_mentions m JOIN identity_revisions r ON r.id=m.current_revision_id WHERE m.organization_id=${org}`;
      return row!;
    };
    const generationId = await this.operations.checkpoint(job, async (tx) => {
      const [existing] =
        await tx`SELECT id,coverage,profile,source_version_id FROM graph_generations WHERE trigger_job_id=${job.id} FOR UPDATE`;
      if (existing) {
        if (
          existing.source_version_id !== versionId ||
          existing.profile !== this.profile() ||
          existing.coverage.sourceHash !== pack.hash
        )
          throw new Error("source_changed");
        if (hash(existing.coverage.identitySnapshot) !== hash(identitySnapshot))
          throw new Error("identity_changed");
        return String(existing.id);
      }
      const id = crypto.randomUUID();
      await tx`INSERT INTO graph_generations(id,organization_id,document_id,source_version_id,profile,state,trigger_operation_id,trigger_job_id,coverage) VALUES(${id},${org},${pack.source.id},${pack.source.version},${this.profile()},'staged',${job.operationId},${job.id},${tx.json({ sourceHash: pack.hash, identitySnapshot, identityEpoch: await epoch(tx) })})`;
      return id;
    });
    const packets = graphPackets(pack.items);
    const manifest = packets.map((packet) => ({
      key: packet.key,
      kind: packet.kind,
      locators: packet.items.map((item) => ({
        version: item.version,
        passageId: item.passageId,
        start: item.start,
        end: item.end,
      })),
    }));
    await this.operations.checkpoint(job, async (tx) => {
      for (const packet of manifest)
        await tx`INSERT INTO graph_packets(generation_id,packet_key,source_locators,state) VALUES(${generationId},${packet.key},${tx.json(packet.locators)},'pending') ON CONFLICT(generation_id,packet_key) DO NOTHING`;
      await tx`UPDATE graph_generations SET coverage=coverage||${tx.json({ packetManifest: manifest, contextPolicy: "utf8-byte-bound+adjacent-and-anchor-v3", normalizationProfile })}::jsonb WHERE id=${generationId}`;
    });
    for (const packet of packets) {
      const [completed] = await this.operations
        .sql`SELECT state,identity_dependencies,exclusions FROM graph_packets WHERE generation_id=${generationId} AND packet_key=${packet.key}`;
      if (completed?.state === "reviewed") continue;
      const mentions = await this.identities.maintenanceMentions(
        job.operationId,
        [...new Set(packet.items.map((item) => item.passageId))],
      );
      const raw = await this.runtime.request(
        job,
        packet.key,
        "graph_extraction",
        2,
        {
          pack: {
            runId: job.id,
            question: "graph",
            items: packet.items,
            hash: hash(packet.items),
            diagnostics: {
              lexicalCandidates: 0,
              vectorCandidates: 0,
              retrievalMs: 0,
              embeddingRequests: 0,
              gaps: [],
            },
          },
          vocabulary: [...predicates],
          mentions,
        },
        (value) => validatePacket(value, packet.items),
      );
      // Register all endpoint inputs before resolving them. Identity events then see
      // exclusion-only references even when the referenced mention belongs elsewhere.
      await this.operations.checkpoint(job, async (tx) => {
        const endpoints = [
          ...new Set([
            ...raw.relations.flatMap((relation) => [
              relation.subjectMention,
              relation.objectMention,
            ]),
            ...raw.exclusions.flatMap((exclusion) =>
              exclusion.mention ? [exclusion.mention] : [],
            ),
          ]),
        ];
        // Serialize registration with M03 pointer updates: an event commits either
        // before this epoch check or after these reverse dependencies are visible.
        await tx`SELECT id FROM identity_mentions WHERE organization_id=${org} AND id::text IN ${tx(endpoints.length ? endpoints : [""])} ORDER BY id FOR SHARE`;
        await tx`UPDATE graph_packets SET endpoint_mentions=${tx.json(endpoints)} WHERE generation_id=${generationId} AND packet_key=${packet.key}`;
        const [generation] =
          await tx`SELECT coverage FROM graph_generations WHERE id=${generationId}`;
        if (hash(generation!.coverage.identityEpoch) !== hash(await epoch(tx)))
          throw new Error(
            job.payload.identityRetry
              ? "needs_attention:identity_changed"
              : "identity_changed",
          );
      });
      const bindings: Array<{
        mentionId: string;
        revisionId: string;
        proofId: string;
      }> = completed?.identity_dependencies ?? [];
      const exclusions: GraphPacketResult["exclusions"] =
        completed?.identity_dependencies == null
          ? [...raw.exclusions]
          : completed.exclusions;
      if (completed?.identity_dependencies == null) {
        for (const mentionId of new Set(
          raw.relations.flatMap((relation) => [
            relation.subjectMention,
            relation.objectMention,
          ]),
        )) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              mentionId,
            )
          ) {
            exclusions.push({
              kind: "unresolved_identity",
              reason: "endpoint has no resolved mention",
              mention: mentionId,
            });
            continue;
          }
          try {
            bindings.push(
              ...(await this.identities.maintenanceDependencies(
                job.operationId,
                [mentionId],
              )),
            );
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "needs_attention:unresolved_identity"
            )
              throw error;
            exclusions.push({
              kind: "unresolved_identity",
              reason: "endpoint has no current original proof",
              mention: mentionId,
            });
          }
        }
        await this.operations.checkpoint(job, async (tx) => {
          await tx`UPDATE graph_packets SET identity_dependencies=${tx.json(bindings)},exclusions=${tx.json(exclusions)} WHERE generation_id=${generationId} AND packet_key=${packet.key}`;
        });
      }
      await this.runtime.request(
        job,
        packet.key,
        "graph_review",
        2,
        { packet: raw, pack: packet.items, mentions, sourceVersion: versionId },
        (value) => validateReview(value, raw),
      );
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE graph_packets SET state='reviewed',relations=${tx.json(jsonValue(raw.relations))},exclusions=${tx.json(jsonValue(exclusions))} WHERE generation_id=${generationId} AND packet_key=${packet.key}`;
      });
    }
    await this.operations.commit(job, async (tx) => {
      await this.publish(tx, job, org, generationId, pack.source.id, versionId);
    });
  }
  private async publish(
    tx: Transaction,
    job: Job,
    org: string,
    generationId: string,
    documentId: string,
    versionId: string,
  ) {
    const [current] =
      await tx`SELECT active_version_id,project_id FROM source_documents WHERE id=${documentId} AND organization_id=${org} FOR SHARE`;
    if (current?.active_version_id !== versionId)
      throw new Error("source_changed");
    const [generation] =
      await tx`SELECT coverage FROM graph_generations WHERE id=${generationId}`;
    const currentIdentities =
      await tx`SELECT m.id,m.current_revision_id FROM identity_mentions m WHERE m.version_id=${versionId} ORDER BY m.id FOR SHARE`;
    if (hash(generation!.coverage.identitySnapshot) !== hash(currentIdentities))
      throw new Error("identity_changed");
    const packets =
      await tx`SELECT relations,identity_dependencies FROM graph_packets WHERE generation_id=${generationId} AND state='reviewed'`;
    const [coverage] =
      await tx`SELECT COUNT(*) FILTER (WHERE state<>'reviewed')::int AS incomplete FROM graph_packets WHERE generation_id=${generationId}`;
    if (Number(coverage?.incomplete ?? 0) !== 0)
      throw new Error("needs_attention:graph_coverage");
    for (const packet of packets)
      await this.identities.assertForPublication(
        tx,
        org,
        packet.identity_dependencies ?? [],
      );
    const relations = packets.flatMap((row) =>
      (row.relations as GraphRelation[]).map((relation) => ({
        relation,
        bindings: (row.identity_dependencies ?? []) as Array<{
          mentionId: string;
          revisionId: string;
          proofId: string;
        }>,
      })),
    );
    for (const { relation, bindings } of relations) {
      const normalized = normalizeRelation(relation);
      const subjectBinding = bindings.find(
        (ref) => ref.mentionId === relation.subjectMention,
      );
      const objectBinding = bindings.find(
        (ref) => ref.mentionId === relation.objectMention,
      );
      if (!subjectBinding || !objectBinding) continue;
      if (
        !/^[0-9a-f-]{36}$/i.test(normalized.subjectMention) ||
        !/^[0-9a-f-]{36}$/i.test(normalized.objectMention) ||
        !predicates.has(normalized.predicate) ||
        !normalized.locators.length
      )
        continue;
      const [subject] =
        await tx`SELECT m.current_revision_id,rev.canonical_id,(SELECT p.id FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid ORDER BY p.id LIMIT 1) AS proof_id FROM identity_mentions m JOIN identity_revisions rev ON rev.id=m.current_revision_id WHERE m.id=${relation.subjectMention} AND m.organization_id=${org} AND m.current_revision_id=${subjectBinding.revisionId} AND EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid)`;
      const [object] =
        await tx`SELECT m.current_revision_id,rev.canonical_id,(SELECT p.id FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid ORDER BY p.id LIMIT 1) AS proof_id FROM identity_mentions m JOIN identity_revisions rev ON rev.id=m.current_revision_id WHERE m.id=${relation.objectMention} AND m.organization_id=${org} AND m.current_revision_id=${objectBinding.revisionId} AND EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid)`;
      if (!subject || !object) continue;
      const identityDeps = [
        {
          mention_id: normalized.subjectMention,
          revision_id: String(subject.current_revision_id),
          proof_id: subjectBinding.proofId,
        },
        {
          mention_id: normalized.objectMention,
          revision_id: String(object.current_revision_id),
          proof_id: objectBinding.proofId,
        },
      ];
      const fingerprint = hash({
        subject: String(subject.canonical_id),
        object: String(object.canonical_id),
        predicate: normalized.predicate,
        direction: normalized.direction,
        scope: {
          projectId: current.project_id ?? null,
          wording: normalized.scope,
        },
        qualifiers: normalized.qualifiers,
        profile: normalizationProfile,
      });
      const [claim] =
        await tx`INSERT INTO graph_claims(id,organization_id,fingerprint,subject_id,object_id,predicate,direction,qualifiers,relation_text,status) VALUES(${crypto.randomUUID()},${org},${fingerprint},${String(subject.canonical_id)},${String(object.canonical_id)},${normalized.predicate},${normalized.direction},${tx.json(jsonValue(normalized.qualifiers))},${normalized.relationText},'active') ON CONFLICT(organization_id,fingerprint) DO UPDATE SET relation_text=excluded.relation_text,status='active' RETURNING id`;
      if (!claim) continue;
      await tx`INSERT INTO graph_supports(claim_id,generation_id,source_version_id,locators,identity_dependencies) VALUES(${String(claim.id)},${generationId},${versionId},${tx.json(normalized.locators)},${tx.json(identityDeps)}) ON CONFLICT(claim_id,generation_id) DO UPDATE SET locators=(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(graph_supports.locators||excluded.locators))`;
    }
    await tx`UPDATE graph_generations SET state='superseded' WHERE document_id=${documentId} AND state='active'`;
    await tx`UPDATE graph_generations SET state='active' WHERE id=${generationId}`;
  }
  neighborhood(
    token: string,
    input: {
      entityId: string;
      projectId?: string;
      predicate?: string;
      hops?: number;
    },
    signal?: AbortSignal,
  ) {
    return new GraphQueries(this.operations, this.access).neighborhood(
      token,
      input,
      signal,
    );
  }
  search(
    token: string,
    question: string,
    projectId?: string,
    signal?: AbortSignal,
  ) {
    return new GraphQueries(this.operations, this.access).search(
      token,
      question,
      projectId,
      signal,
    );
  }
  async inspect(token: string, operationId: string) {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT g.id,g.state,g.profile,g.source_version_id,g.document_id,g.created_at,g.coverage,g.trigger_job_id,COUNT(p.*)::int AS packets,COUNT(p.*) FILTER(WHERE p.state='reviewed')::int AS reviewed,
        (SELECT count(*)::int FROM graph_supports s WHERE s.generation_id=g.id) AS memberships,
        (SELECT jsonb_agg(jsonb_build_object('key',detail.packet_key,'state',detail.state,'locators',detail.source_locators,'exclusions',detail.exclusions,'error',detail.error) ORDER BY detail.packet_key) FROM graph_packets detail WHERE detail.generation_id=g.id) AS details,
        (SELECT jsonb_agg(jsonb_build_object('unit',a.unit_key,'phase',a.phase,'attempt',a.attempt,'state',a.state) ORDER BY a.unit_key,a.phase,a.attempt) FROM wiki_model_attempts a WHERE a.job_id=g.trigger_job_id) AS requests,
        (SELECT jsonb_agg(jsonb_build_object('unit',u.unit_key,'deadline',u.deadline) ORDER BY u.unit_key) FROM wiki_work_units u WHERE u.job_id=g.trigger_job_id) AS deadlines FROM graph_generations g LEFT JOIN graph_packets p ON p.generation_id=g.id WHERE g.trigger_operation_id=${operationId} AND g.organization_id=${context.organizationId} GROUP BY g.id`;
    return {
      generations: rows.map((row) => ({
        id: String(row.id),
        profile: String(row.profile),
        sourceVersion: String(row.source_version_id),
        documentId: String(row.document_id),
        createdAt: new Date(row.created_at).toISOString(),
        state: String(row.state),
        coverage: row.coverage,
        packets: Number(row.packets),
        reviewed: Number(row.reviewed),
        memberships: Number(row.memberships),
        details: (row.details ?? []) as Array<{
          key: string;
          state: string;
          locators: Array<{
            version: string;
            passageId: string;
            start: number;
            end: number;
          }>;
          exclusions: GraphPacketResult["exclusions"];
          error: string | null;
        }>,
        requests: (row.requests ?? []) as Array<{
          unit: string;
          phase: string;
          attempt: number;
          state: string;
        }>,
        deadlines: (row.deadlines ?? []) as Array<{
          unit: string;
          deadline: string;
        }>,
      })),
    };
  }
  close() {
    return this.operations.close();
  }
}
function validatePacket(
  raw: unknown,
  items: GraphOriginal[],
): GraphPacketResult {
  if (
    !record(raw) ||
    !Array.isArray(raw.relations) ||
    raw.relations.length > 20 ||
    !Array.isArray(raw.exclusions) ||
    raw.complete !== true
  )
    throw new Error("needs_attention:graph_coverage");
  const locators = new Set(items.map((item) => item.passageId));
  for (const relation of raw.relations) {
    if (!record(relation)) throw new Error("needs_attention:graph_schema");
    if (
      typeof relation.subjectMention !== "string" ||
      typeof relation.objectMention !== "string" ||
      typeof relation.predicate !== "string" ||
      !predicates.has(relation.predicate) ||
      !["forward", "reverse"].includes(String(relation.direction)) ||
      typeof relation.relationText !== "string" ||
      typeof relation.scope !== "string" ||
      !record(relation.qualifiers) ||
      !Array.isArray(relation.locators) ||
      !relation.locators.length ||
      relation.locators.some(
        (locator: unknown) =>
          typeof locator !== "string" || !locators.has(locator),
      )
    )
      throw new Error("needs_attention:graph_schema");
    if (
      relation.qualifiers.negated !== undefined &&
      typeof relation.qualifiers.negated !== "boolean"
    )
      throw new Error("needs_attention:graph_schema");
    if (
      relation.qualifiers.status !== undefined &&
      !["planned", "current", "historical"].includes(
        String(relation.qualifiers.status),
      )
    )
      throw new Error("needs_attention:graph_schema");
  }
  for (const exclusion of raw.exclusions)
    if (
      !record(exclusion) ||
      typeof exclusion.kind !== "string" ||
      typeof exclusion.reason !== "string"
    )
      throw new Error("needs_attention:graph_schema");
  return raw as unknown as GraphPacketResult;
}
function validateReview(raw: unknown, packet: GraphPacketResult) {
  if (
    !record(raw) ||
    raw.evidenceHash !== hash(packet.relations) ||
    raw.complete !== true ||
    !Array.isArray(raw.relations) ||
    raw.relations.length !== packet.relations.length ||
    raw.relations.some(
      (relation: unknown) =>
        !record(relation) ||
        relation.verdict !== "supported" ||
        relation.qualifiersChecked !== true,
    )
  )
    throw new Error("needs_attention:graph_review_failed");
  return true;
}
