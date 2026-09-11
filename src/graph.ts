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
    qualifiers: {
      ...relation.qualifiers,
      ...(relation.qualifiers.status ? {} : { status: "current" as const }),
    },
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
    model: GraphModel,
  ) {
    this.operations = new Operations(url);
    this.runtime = new WikiModelRuntime(
      this.operations,
      model,
      new BackgroundAdmission(url),
    );
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
    const items = source.passages.flatMap((passage, passageIndex) => {
      const points = Array.from(passage.text),
        chunks = [];
      for (let offset = 0; offset < points.length; offset += 3000) {
        const text = points.slice(offset, offset + 3000).join("");
        chunks.push({
          documentId: source.id,
          version: source.version,
          passageId: passage.id,
          title: source.title,
          text,
          headingPath: passage.headingPath,
          start: passage.start + offset,
          end: passage.start + offset + text.length,
          handle: `g${passage.ordinal}:${offset}`,
          context: [
            passage.headingPath.join(" > "),
            source.passages[passageIndex - 1]?.text.slice(-500) ?? "",
            source.passages[passageIndex + 1]?.text.slice(0, 500) ?? "",
          ]
            .filter(Boolean)
            .join("\n"),
        });
      }
      return chunks;
    });
    return { source, items, hash: hash(items) };
  }
  private async run(job: Job) {
    const [owner] = await this.operations
      .sql`SELECT organization_id FROM knowledge_operations WHERE id=${job.operationId}`;
    const org = String(owner!.organization_id);
    let versionId = String(job.payload.versionId ?? "");
    let identityVersions: string[] = [];
    if (job.kind === "graph.identity") {
      const sources = await this.operations
        .sql`SELECT DISTINCT s.id FROM source_versions s JOIN graph_supports g ON g.source_version_id=s.id JOIN graph_generations gen ON gen.id=g.generation_id AND gen.state='active' WHERE g.identity_dependencies @> ${this.operations.sql.json([{ mention_id: String(job.payload.mentionId) }])}::jsonb ORDER BY s.id`;
      identityVersions = sources.map((source) => String(source.id));
      versionId = identityVersions.shift() ?? "";
      if (!versionId) throw new Error("needs_attention:unresolved_identity");
    }
    const pack = await this.sourcePack(job, versionId);
    const identitySnapshot = await this.operations
      .sql`SELECT m.id,m.current_revision_id FROM identity_mentions m WHERE m.version_id=${versionId} ORDER BY m.id`;
    const generationId = crypto.randomUUID();
    await this.operations.checkpoint(job, async (tx) => {
      await tx`INSERT INTO graph_generations(id,organization_id,document_id,source_version_id,profile,state,trigger_operation_id,coverage) VALUES(${generationId},${org},${pack.source.id},${pack.source.version},'graph-v1','staged',${job.operationId},${tx.json({ sourceHash: pack.hash, identitySnapshot })})`;
    });
    const packets: Array<{
      key: string;
      items: typeof pack.items;
      kind?: string;
    }> = [];
    const manifest: Array<{ key: string; kind: string; locators: string[] }> =
      [];
    let index = 0;
    for (let start = 0; start < pack.items.length;) {
      const packetItems = [];
      let primaryTokens = 0;
      let contextTokens = 0;
      const packetStart = start;
      while (
        start < pack.items.length &&
        primaryTokens + estimatedTokens(pack.items[start]!.text) <= 3000 &&
        contextTokens + estimatedTokens(pack.items[start]!.context ?? "") <=
          1000
      ) {
        const item = pack.items[start++]!;
        packetItems.push(item);
        primaryTokens += estimatedTokens(item.text);
        contextTokens += estimatedTokens(item.context ?? "");
      }
      if (!packetItems.length)
        throw new Error("needs_attention:graph_packet_overflow");
      const items = packetItems,
        key = `packet:${index++}`;
      packets.push({ key, items });
      manifest.push({
        key,
        kind: "primary",
        locators: [...new Set(items.map((item) => item.passageId))],
      });
      await this.operations.checkpoint(job, async (tx) => {
        await tx`INSERT INTO graph_packets(generation_id,packet_key,source_locators,state) VALUES(${generationId},${key},${tx.json(items.map((item) => ({ version: item.version, passageId: item.passageId, start: item.start, end: item.end })))} ,'pending')`;
      });
      if (pack.items.length > items.length) {
        const bridgeCandidates = [
          pack.items[Math.max(0, packetStart - 1)],
          pack.items[Math.min(pack.items.length - 1, start)],
        ].filter(
          (item): item is (typeof pack.items)[number] =>
            item !== undefined && !items.includes(item as never),
        );
        const bridgeItems: typeof pack.items = [];
        let bridgeTokens = 0;
        for (const item of bridgeCandidates) {
          const cost =
            estimatedTokens(item.text) + estimatedTokens(item.context ?? "");
          if (bridgeTokens + cost > 4000) continue;
          bridgeItems.push(item);
          bridgeTokens += cost;
        }
        const bridgeKey = `bridge:${key}`;
        packets.push({ key: bridgeKey, items: bridgeItems, kind: "bridge" });
        manifest.push({
          key: bridgeKey,
          kind: "bridge",
          locators: [...new Set(bridgeItems.map((item) => item.passageId))],
        });
        await this.operations.checkpoint(job, async (tx) => {
          await tx`INSERT INTO graph_packets(generation_id,packet_key,source_locators,state) VALUES(${generationId},${bridgeKey},${tx.json(bridgeItems.map((item) => ({ version: item.version, passageId: item.passageId, start: item.start, end: item.end })))} ,'pending')`;
        });
      }
    }
    if (!packets.length) {
      packets.push({ key: "packet:0", items: [] });
      manifest.push({ key: "packet:0", kind: "primary", locators: [] });
      await this.operations.checkpoint(job, async (tx) => {
        await tx`INSERT INTO graph_packets(generation_id,packet_key,source_locators,state) VALUES(${generationId},'packet:0','[]'::jsonb,'pending')`;
      });
    }
    await this.operations.checkpoint(job, async (tx) => {
      await tx`UPDATE graph_generations SET coverage=coverage || ${tx.json({ packetManifest: manifest, contextPolicy: "heading+adjacent-500", normalizationProfile })} WHERE id=${generationId}`;
    });
    for (const packet of packets) {
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
        },
        (value) => validatePacket(value, packet.items),
      );
      const reviewed = await this.runtime.request(
        job,
        packet.key,
        "graph_review",
        2,
        { packet: raw, pack: packet.items, sourceVersion: versionId },
        (value) => validateReview(value, raw),
      );
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE graph_packets SET state='reviewed',relations=${tx.json(jsonValue(raw.relations))},exclusions=${tx.json(jsonValue(raw.exclusions))} WHERE generation_id=${generationId} AND packet_key=${packet.key}`;
      });
    }
    await this.operations.commit(job, async (tx) => {
      await this.publish(
        tx,
        job,
        org,
        generationId,
        pack.source.id,
        versionId,
        packets.map((packet) => packet.items).flat(),
      );
      for (const replacementVersion of identityVersions)
        await this.operations.enqueue(tx, job.operationId, "graph.refresh", {
          versionId: replacementVersion,
          identityReplacement: true,
        });
    });
  }
  private async publish(
    tx: Transaction,
    job: Job,
    org: string,
    generationId: string,
    documentId: string,
    versionId: string,
    items: any[],
  ) {
    const [current] =
      await tx`SELECT active_version_id FROM source_documents WHERE id=${documentId} AND organization_id=${org} FOR SHARE`;
    if (current?.active_version_id !== versionId)
      throw new Error("source_changed");
    const packets =
      await tx`SELECT relations FROM graph_packets WHERE generation_id=${generationId} AND state='reviewed'`;
    const [coverage] =
      await tx`SELECT COUNT(*) FILTER (WHERE state<>'reviewed')::int AS incomplete FROM graph_packets WHERE generation_id=${generationId}`;
    if (Number(coverage?.incomplete ?? 0) !== 0)
      throw new Error("needs_attention:graph_coverage");
    const relations = packets.flatMap(
      (row) => row.relations as GraphRelation[],
    );
    for (const relation of relations) {
      const normalized = normalizeRelation(relation);
      if (
        !/^[0-9a-f-]{36}$/i.test(normalized.subjectMention) ||
        !/^[0-9a-f-]{36}$/i.test(normalized.objectMention) ||
        !predicates.has(normalized.predicate) ||
        !normalized.locators.length
      )
        continue;
      const [subject] =
        await tx`SELECT m.current_revision_id,rev.canonical_id,(SELECT p.id FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid ORDER BY p.id LIMIT 1) AS proof_id FROM identity_mentions m JOIN identity_revisions rev ON rev.id=m.current_revision_id WHERE m.id=${relation.subjectMention} AND m.organization_id=${org} AND EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid)`;
      const [object] =
        await tx`SELECT m.current_revision_id,rev.canonical_id,(SELECT p.id FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid ORDER BY p.id LIMIT 1) AS proof_id FROM identity_mentions m JOIN identity_revisions rev ON rev.id=m.current_revision_id WHERE m.id=${relation.objectMention} AND m.organization_id=${org} AND EXISTS(SELECT 1 FROM identity_proof_eligibility p WHERE p.revision_id=m.current_revision_id AND p.valid)`;
      if (!subject || !object) continue;
      const identityDeps = [
        {
          mention_id: normalized.subjectMention,
          revision_id: String(subject.current_revision_id),
          proof_id: String(subject.proof_id),
        },
        {
          mention_id: normalized.objectMention,
          revision_id: String(object.current_revision_id),
          proof_id: String(object.proof_id),
        },
      ];
      const fingerprint = hash({
        subject: String(subject.canonical_id),
        object: String(object.canonical_id),
        predicate: normalized.predicate,
        direction: normalized.direction,
        scope: normalized.scope,
        qualifiers: normalized.qualifiers,
        profile: normalizationProfile,
      });
      const [claim] =
        await tx`INSERT INTO graph_claims(id,organization_id,fingerprint,subject_id,object_id,predicate,direction,qualifiers,relation_text,status) VALUES(${crypto.randomUUID()},${org},${fingerprint},${String(subject.canonical_id)},${String(object.canonical_id)},${normalized.predicate},${normalized.direction},${tx.json(jsonValue(normalized.qualifiers))},${normalized.relationText},'active') ON CONFLICT(organization_id,fingerprint) DO UPDATE SET relation_text=excluded.relation_text,status='active' RETURNING id`;
      if (!claim) continue;
      await tx`INSERT INTO graph_supports(claim_id,generation_id,source_version_id,locators,identity_dependencies) VALUES(${String(claim.id)},${generationId},${versionId},${tx.json(normalized.locators)},${tx.json(identityDeps)}) ON CONFLICT DO NOTHING`;
    }
    await tx`DELETE FROM graph_supports WHERE generation_id IN (SELECT id FROM graph_generations WHERE document_id=${documentId} AND state='active')`;
    await tx`UPDATE graph_generations SET state='superseded' WHERE document_id=${documentId} AND state='active'`;
    await tx`UPDATE graph_generations SET state='active' WHERE id=${generationId}`;
  }
  async neighborhood(
    token: string,
    input: {
      entityId: string;
      projectId?: string;
      predicate?: string;
      hops?: number;
    },
  ) {
    const context = await this.access.authorize(token, "read", input.projectId);
    const hops = Math.min(2, Math.max(1, input.hops ?? 2));
    const rows = await this.operations
      .sql`WITH RECURSIVE walk(id,depth,path) AS (
        SELECT ${input.entityId}::uuid,0,ARRAY[${input.entityId}::uuid]
        UNION ALL
        SELECT CASE WHEN c.subject_id=walk.id THEN c.object_id ELSE c.subject_id END,
          walk.depth+1, path || CASE WHEN c.subject_id=walk.id THEN c.object_id ELSE c.subject_id END
        FROM walk
        JOIN graph_claims c ON (c.subject_id=walk.id OR c.object_id=walk.id)
        JOIN graph_supports s ON s.claim_id=c.id
        JOIN graph_generations g ON g.id=s.generation_id AND g.state='active'
        JOIN source_versions v ON v.id=s.source_version_id AND v.state='active'
        JOIN source_documents d ON d.id=v.document_id
        WHERE walk.depth<${hops} AND c.organization_id=${context.organizationId} AND c.status='active'
          AND (${context.scope.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${context.scope.projectId ?? null}::uuid)
          AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(s.identity_dependencies) dep(mention_id uuid, revision_id uuid, proof_id uuid) LEFT JOIN identity_mentions im ON im.id=dep.mention_id LEFT JOIN identity_proof_eligibility pe ON pe.id=dep.proof_id AND pe.revision_id=dep.revision_id AND pe.valid WHERE im.current_revision_id IS DISTINCT FROM dep.revision_id OR pe.id IS NULL)
          AND NOT (CASE WHEN c.subject_id=walk.id THEN c.object_id ELSE c.subject_id END = ANY(path))
      )
      SELECT DISTINCT ON (c.id) c.id,c.subject_id,c.object_id,c.predicate,c.direction,c.qualifiers,c.relation_text,s.source_version_id,s.locators
      FROM graph_claims c
      JOIN graph_supports s ON s.claim_id=c.id
      JOIN graph_generations g ON g.id=s.generation_id AND g.state='active'
      JOIN source_versions v ON v.id=s.source_version_id AND v.state='active'
      JOIN source_documents d ON d.id=v.document_id
      JOIN walk ON walk.id IN (c.subject_id,c.object_id)
      WHERE c.organization_id=${context.organizationId} AND c.status='active'
      AND (${context.scope.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${context.scope.projectId ?? null}::uuid)
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(s.identity_dependencies) dep(mention_id uuid, revision_id uuid, proof_id uuid) LEFT JOIN identity_mentions im ON im.id=dep.mention_id LEFT JOIN identity_proof_eligibility pe ON pe.id=dep.proof_id AND pe.revision_id=dep.revision_id AND pe.valid WHERE im.current_revision_id IS DISTINCT FROM dep.revision_id OR pe.id IS NULL)
      ${input.predicate ? this.operations.sql`AND c.predicate=${input.predicate}` : this.operations.sql``}
      LIMIT 101`;
    return {
      claims: rows.map((row) => ({
        id: String(row.id),
        subjectMention: String(row.subject_id),
        objectMention: String(row.object_id),
        predicate: String(row.predicate),
        direction: String(row.direction),
        qualifiers: row.qualifiers,
        relationText: String(row.relation_text),
        sourceVersion: String(row.source_version_id),
        support: (row.locators as string[]).map((passageId) => ({
          version: String(row.source_version_id),
          passageId,
        })),
      })),
      truncated: rows.length > 100,
      pending: await this.pending(context.organizationId),
    };
  }
  async search(
    token: string,
    question: string,
    projectId?: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const context = await this.access.authorize(token, "read", projectId);
    const terms = question
      .split(/\s+/)
      .map((term) => term.replace(/[%'_]/g, "").trim())
      .filter((term) => term.length >= 2)
      .slice(0, 8);
    const pattern = terms.length ? `%${terms.join("%")}%` : "%";
    const query = this.operations.sql`
      SELECT DISTINCT ON (c.id) c.id,c.subject_id,c.object_id,c.predicate,c.direction,c.qualifiers,c.relation_text,
        s.source_version_id,s.locators
      FROM graph_claims c JOIN graph_supports s ON s.claim_id=c.id
      JOIN graph_generations g ON g.id=s.generation_id AND g.state='active'
      JOIN source_versions v ON v.id=s.source_version_id AND v.state='active'
      JOIN source_documents d ON d.id=v.document_id
      WHERE c.organization_id=${context.organizationId} AND c.status='active'
        AND (${context.scope.projectId ?? null}::uuid IS NULL OR d.project_id IS NULL OR d.project_id=${context.scope.projectId ?? null}::uuid)
        AND c.relation_text ILIKE ${pattern}
      LIMIT 100`;
    const cancel = () => query.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    let rows;
    try {
      rows = await query;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    signal?.throwIfAborted();
    return {
      claims: rows.map((row) => ({
        id: String(row.id),
        predicate: String(row.predicate),
        direction: String(row.direction),
        qualifiers: row.qualifiers,
        relationText: String(row.relation_text),
        sourceVersion: String(row.source_version_id),
        support: (row.locators as string[]).map((passageId) => ({
          version: String(row.source_version_id),
          passageId,
        })),
      })),
      truncated: rows.length >= 100,
      pending: await this.pending(context.organizationId),
    };
  }
  async pending(organizationId: string) {
    const [row] = await this.operations
      .sql`SELECT count(*) AS count FROM graph_generations WHERE organization_id=${organizationId} AND state='staged'`;
    return Number(row?.count ?? 0) > 0;
  }
  async inspect(token: string, operationId: string) {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT g.id,g.state,g.coverage,COUNT(p.*)::int AS packets,COUNT(p.*) FILTER(WHERE p.state='reviewed')::int AS reviewed FROM graph_generations g LEFT JOIN graph_packets p ON p.generation_id=g.id WHERE g.trigger_operation_id=${operationId} AND g.organization_id=${context.organizationId} GROUP BY g.id`;
    return {
      generations: rows.map((row) => ({
        id: String(row.id),
        state: String(row.state),
        coverage: row.coverage,
        packets: Number(row.packets),
        reviewed: Number(row.reviewed),
      })),
    };
  }
  close() {
    return this.operations.close();
  }
}
function estimatedTokens(value: string) {
  return Math.max(1, Math.ceil(Array.from(value).length / 4));
}
function validatePacket(raw: unknown, items: any[]): GraphPacketResult {
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
