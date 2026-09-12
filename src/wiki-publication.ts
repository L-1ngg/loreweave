import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import { SourceService } from "./sources.ts";
import { IdentityService } from "./identity.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import { hash, validateDraft, validateReview } from "./answer-validation.ts";
import { conflictPacks } from "./wiki-conflicts.ts";
import { packetPacks } from "./wiki-packets.ts";
import {
  normalizeTitle as normalize,
  descriptorText,
} from "./wiki-catalogue.ts";
import { lexicalText } from "./indexing.ts";
import type {
  WikiModel,
  TopicDescriptor,
  WikiPack,
  WikiCertificate,
} from "./wiki-types.ts";
export interface ContentEdit {
  pageId: string;
  versionId: string;
  reviewed: { text: string; certificates: WikiCertificate[] };
  revisions: Record<string, number>;
  check: (tx: Transaction) => Promise<void>;
  apply: (tx: Transaction) => Promise<void>;
}
/** One support-review and publication path for maintenance and structural edits. */
export class WikiPublication {
  constructor(
    private readonly operations: Operations,
    private readonly sources: SourceService,
    private readonly identities: IdentityService,
    private readonly embeddings: EmbeddingAdapter,
    private readonly runtime: WikiModelRuntime,
    private readonly model: WikiModel,
  ) {}
  async prepare(
    job: Job,
    organizationId: string,
    scope: string,
    topic: TopicDescriptor,
    pack: WikiPack,
    index: number | string,
    revisions: Record<string, number>,
    check: (tx: Transaction) => Promise<void>,
    existing?: { id: string; version: string },
  ): Promise<ContentEdit> {
    const pageId = existing?.id ?? crypto.randomUUID(),
      versionId = crypto.randomUUID();
    const blocks: Array<{ text: string; certificate: WikiCertificate }> = [];
    const conflicts = await conflictPacks(
      this.operations,
      this.runtime,
      job,
      topic,
      pack,
      index,
    );
    const ordinaryBlocks = packetPacks(pack, 2000);
    for (const [blockIndex, block] of [
      ...ordinaryBlocks,
      ...conflicts,
    ].entries()) {
      const requiredConflict =
        blockIndex >= ordinaryBlocks.length
          ? block.items.map((item) => item.handle)
          : undefined;
      let feedback: unknown;
      let reviewed: { text: string; certificate: WikiCertificate } | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const draft = await this.runtime.request(
          job,
          `block:${index}:${blockIndex}`,
          "generation",
          3,
          {
            pack: block,
            topic,
            feedback,
            ...(requiredConflict ? { requiredConflict } : {}),
          },
          (raw) => {
            const draft = validateDraft(raw, block, {
              maxBytes: 16000,
              maxClaims: 128,
            });
            if (
              draft.text !== `# ${topic.title}` &&
              !draft.text.startsWith(`# ${topic.title}\n`)
            )
              throw new Error("unreviewed_title");
            if (new TextEncoder().encode(draft.text).length > 4000)
              throw new Error("wiki_block_too_large");
            if (
              requiredConflict &&
              !draft.claims.some(
                (claim) =>
                  claim.start > topic.title.length + 2 &&
                  requiredConflict.every((handle) =>
                    claim.handles.includes(handle),
                  ),
              )
            )
              throw new Error("missing_conflict_claim");
            return draft;
          },
        );
        const review = await this.runtime.request(
          job,
          `block:${index}:${blockIndex}`,
          "review",
          3,
          {
            pack: block,
            topic,
            draft,
            ...(requiredConflict ? { requiredConflict } : {}),
          },
          (raw) => validateReview(raw, draft, block, 16000),
        );
        if (review.claims.every((claim) => claim.verdict === "supported")) {
          reviewed = {
            text: draft.text,
            certificate: {
              draft,
              evidence: block.items,
              offset: blocks.reduce(
                (total, item) => total + item.text.length + 2,
                0,
              ),
              draftHash: draft.hash,
              evidenceHash: block.hash,
              review,
              model: this.model.profile,
              prompt: "wiki-support-v1",
              policy: "V01-wiki-v1",
              checkedAt: new Date().toISOString(),
            },
          };
          break;
        }
        feedback = { draft, review };
      }
      if (!reviewed) throw new Error("insufficient_evidence");
      blocks.push(reviewed);
    }
    const reviewed = {
      text: blocks.map((block) => block.text).join("\n\n"),
      certificates: blocks.map((block) => block.certificate),
    };
    let vector: number[] | undefined;
    try {
      const vectors = await this.embeddings.embed(
        [descriptorText(topic)],
        this.operations.signal(job, AbortSignal.timeout(45000)),
      );
      validateEmbeddings(vectors, 1, this.embeddings.dimensions);
      vector = vectors[0];
    } catch {
      // The required lexical catalogue publishes even when its optional vector projection is pending.
    }
    return {
      pageId,
      versionId,
      reviewed,
      revisions,
      check,
      apply: async (tx) => {
        const publishedEntities = await this.identities.assertForPublication(
          tx,
          organizationId,
          topic.identities,
        );
        await this.sources.assertCurrentForPublication(
          tx,
          organizationId,
          pack.items,
        );
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${organizationId}`},0))`;
        if (existing) {
          const [page] =
            await tx`SELECT current_version_id FROM wiki_pages WHERE id=${pageId} FOR UPDATE`;
          if (page?.current_version_id !== existing.version)
            throw new Error("version_conflict");
        } else {
          const [duplicate] =
            await tx`SELECT c.page_id FROM wiki_routing_catalogue c JOIN wiki_pages p ON p.id=c.page_id WHERE p.organization_id=${organizationId} AND COALESCE(p.project_id::text,'shared')=${scope} AND (EXISTS(SELECT 1 FROM jsonb_array_elements_text(${tx.json([topic.title, ...topic.aliases].map(normalize))}::jsonb) name WHERE c.normalized_title=name.value OR c.routing_aliases ? name.value) OR (c.subject_key=${topic.subjectKey} AND c.aspect_key=${topic.aspectKey}))`;
          const topicKey = hash({
            subject: topic.subjectKey,
            aspect: topic.aspectKey,
          });
          const [reservation] =
            await tx`SELECT * FROM wiki_reservations WHERE organization_id=${organizationId} AND scope=${scope} AND topic_key=${topicKey} FOR UPDATE`;
          if (reservation && reservation.operation_id !== job.operationId)
            throw new Error("needs_attention:reservation_outcome");
          if (duplicate)
            throw new Error("needs_attention:literal_topic_collision");
          await tx`INSERT INTO wiki_reservations(organization_id,scope,topic_key,operation_id,decision_id) VALUES(${organizationId},${scope},${topicKey},${job.operationId},${job.id}) ON CONFLICT DO NOTHING`;
          await tx`INSERT INTO wiki_pages(id,organization_id,project_id) VALUES(${pageId},${organizationId},${scope === "shared" ? null : scope})`;
        }
        await tx`INSERT INTO wiki_versions(id,page_id,operation_id,expected_prior,title,body,sources,identity_dependencies,certificates,descriptor) VALUES(${versionId},${pageId},${job.operationId},${existing ? String(existing.version) : null},${topic.title},${reviewed!.text},${tx.json(jsonValue(pack.items))},${tx.json(topic.identities)},${tx.json(jsonValue(reviewed.certificates))},${tx.json(jsonValue(topic))})`;
        for (const item of pack.items)
          await tx`INSERT INTO wiki_page_sources(version_id,source_version_id,passage_id) VALUES(${versionId},${item.version},${item.passageId}) ON CONFLICT DO NOTHING`;
        for (const version of new Set(pack.items.map((item) => item.version)))
          await tx`INSERT INTO wiki_version_inputs(version_id,source_version_id) VALUES(${versionId},${version}) ON CONFLICT DO NOTHING`;
        await tx`UPDATE wiki_pages SET current_version_id=${versionId},lifecycle='active',retirement=NULL WHERE id=${pageId}`;
        await tx`UPDATE wiki_reservations SET state='published',page_id=${pageId} WHERE organization_id=${organizationId} AND scope=${scope} AND operation_id=${job.operationId} AND decision_id=${job.id} AND state='pending'`;
        await tx`INSERT INTO wiki_catalogue(page_id,version_id,normalized_title,subject_key,aspect_key,descriptor,lexical_text,embedding,embedding_profile,dimensions,title_lexical,aliases,subject_ids,body_lexical) VALUES(${pageId},${versionId},${normalize(topic.title)},${topic.subjectKey},${topic.aspectKey},${tx.json(jsonValue(topic))},${lexicalText(descriptorText(topic))},${vector ? JSON.stringify(vector) : null}::vector,${this.embeddings.profile},${this.embeddings.dimensions},${lexicalText([topic.title, ...topic.aliases].join(" "))},${tx.json(topic.aliases.map(normalize))},${tx.json(publishedEntities)},${lexicalText(reviewed.text)}) ON CONFLICT(page_id) DO UPDATE SET version_id=excluded.version_id,normalized_title=excluded.normalized_title,subject_key=excluded.subject_key,aspect_key=excluded.aspect_key,descriptor=excluded.descriptor,lexical_text=excluded.lexical_text,embedding=excluded.embedding,embedding_profile=excluded.embedding_profile,dimensions=excluded.dimensions,title_lexical=excluded.title_lexical,aliases=excluded.aliases,subject_ids=excluded.subject_ids,body_lexical=excluded.body_lexical`;
        if (!vector)
          await this.operations.enqueue(
            tx,
            job.operationId,
            "wiki.project",
            { pageId, versionId },
            versionId,
          );
        await tx`INSERT INTO wiki_catalogue_scopes(organization_id,scope,revision) VALUES(${organizationId},${scope},1) ON CONFLICT(organization_id,scope) DO UPDATE SET revision=wiki_catalogue_scopes.revision+1`;
      },
    };
  }
}
