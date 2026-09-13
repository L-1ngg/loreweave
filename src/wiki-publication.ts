import { sectionPacks, evidenceContext } from "./wiki-sections.ts";
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
    const [priorVersion] = existing
      ? await this.operations
          .sql`SELECT certificates FROM wiki_versions WHERE id=${existing.version} AND page_id=${pageId}`
      : [];
    const previous = (priorVersion?.certificates ?? []) as WikiCertificate[];
    const guidance = await this.operations
      .sql`SELECT id,body FROM wiki_guidance WHERE organization_id=${organizationId} AND (page_id IS NULL OR page_id=${pageId}) AND (project_id IS NULL OR project_id::text=${scope}) ORDER BY id`;
    const contextHash = hash({
      topic: {
        title: topic.title,
        aliases: topic.aliases,
        question: topic.question,
        subjectKey: topic.subjectKey,
        aspectKey: topic.aspectKey,
        inclusion: topic.inclusion,
        exclusion: topic.exclusion,
        identities: topic.identities.map((ref) => ({
          mentionId: ref.mentionId,
          revisionId: ref.revisionId,
          proofId: ref.proofId,
        })),
        identityRequired: topic.identityRequired,
      },
      scope,
      guidance,
      assembly: "reviewed-section-v1",
      model: this.model.profile,
      policy: "V01-wiki-v2-sections",
    });
    const conflicts = await conflictPacks(
      this.operations,
      this.runtime,
      job,
      topic,
      pack,
      index,
    );
    const ordinaryBlocks = await sectionPacks(
      this.runtime,
      job,
      topic,
      pack,
      pageId,
      previous,
      index,
    );
    const plannedBlocks = [
      ...ordinaryBlocks,
      ...conflicts.map((block, continuation) => ({
        block,
        section: {
          id: hash({ pageId, key: "conflicts" }),
          key: "conflicts",
          purpose: "Unresolved source conflicts",
        },
        continuation,
      })),
    ];
    const prepareBlock = async (blockIndex: number) => {
      const planned = plannedBlocks[blockIndex]!;
      const { block, section, continuation } = planned;
      const requiredConflict =
        blockIndex >= ordinaryBlocks.length
          ? block.items.map((item) => item.handle)
          : undefined;
      const previousCertificate = !requiredConflict
        ? previous.find(
            (certificate) =>
              certificate.section?.id === section.id &&
              certificate.contextHash === contextHash &&
              certificate.evidence.length === block.items.length &&
              certificate.evidence.every(
                (item) =>
                  block.items.filter(
                    (next) => evidenceContext(item) === evidenceContext(next),
                  ).length === 1,
              ),
          )
        : undefined;
      let reusableDraft: import("./answer-validation.ts").Draft | undefined;
      if (previousCertificate) {
        const handles = new Map(
          previousCertificate.evidence.map((item) => [
            item.handle,
            block.items.find(
              (next) => evidenceContext(item) === evidenceContext(next),
            )!.handle,
          ]),
        );
        try {
          reusableDraft = validateDraft(
            {
              ...previousCertificate.draft,
              claims: previousCertificate.draft.claims.map((claim) => ({
                ...claim,
                handles: claim.handles.map((handle) => handles.get(handle)!),
              })),
            },
            block,
            { maxBytes: 16000, maxClaims: 128 },
          );
        } catch {
          /* Legacy or ambiguous claim mapping requires regeneration. */
        }
      }
      let feedback: unknown;
      let reviewed: { text: string; certificate: WikiCertificate } | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const draft =
          (attempt === 0 ? reusableDraft : undefined) ??
          (await this.runtime.request(
            job,
            `block:${index}:${blockIndex}`,
            "generation",
            3,
            {
              pack: block,
              topic,
              section,
              continuation,
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
          ));
        const review = await this.runtime.request(
          job,
          `block:${index}:${blockIndex}`,
          "review",
          3,
          {
            pack: block,
            topic,
            section,
            continuation,
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
              section,
              continuation,
              contextHash,
              generationReused: Boolean(attempt === 0 && reusableDraft),
              evidence: block.items,
              offset: 0,
              draftHash: draft.hash,
              evidenceHash: block.hash,
              review,
              model: this.model.profile,
              prompt: "wiki-support-v1",
              policy: "V01-wiki-v2-sections",
              checkedAt: new Date().toISOString(),
            },
          };
          break;
        }
        feedback = { draft, review };
      }
      if (!reviewed) throw new Error("insufficient_evidence");
      return reviewed;
    };
    const sections = new Map<string, number[]>();
    for (const [blockIndex, planned] of plannedBlocks.entries()) {
      const indices = sections.get(planned.section.id) ?? [];
      indices.push(blockIndex);
      sections.set(planned.section.id, indices);
    }
    const groups = [...sections.values()];
    const prepared = new Array<Awaited<ReturnType<typeof prepareBlock>>>(
      plannedBlocks.length,
    );
    let nextSection = 0,
      failed = false;
    // Each section preserves its continuation order. Separate sections share two
    // local lanes; every HTTP request still passes global model admission.
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.min(2, groups.length) }, async () => {
        while (!failed && nextSection < groups.length) {
          const group = groups[nextSection++]!;
          try {
            for (const blockIndex of group) {
              if (failed) return;
              prepared[blockIndex] = await prepareBlock(blockIndex);
            }
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      }),
    );
    // Keep the job's heartbeat and fence until all started work has settled,
    // including when a peer's review failed. Nothing is published on failure.
    for (const outcome of outcomes)
      if (outcome.status === "rejected") throw outcome.reason;
    for (const [blockIndex, reviewed] of prepared.entries()) {
      const { section } = plannedBlocks[blockIndex]!;
      // Remove only repeated, already-reviewed headings; never introduce connective claims.
      const pageHeading = `# ${topic.title}`;
      const sectionHeading = `${pageHeading}\n\n## ${section.purpose}`;
      const sameSection = blocks.some(
        (block) => block.certificate.section?.id === section.id,
      );
      let cut = 0;
      if (blocks.length) {
        cut =
          sameSection && reviewed.text.startsWith(sectionHeading)
            ? sectionHeading.length
            : reviewed.text.startsWith(pageHeading)
              ? pageHeading.length
              : 0;
        while (reviewed.text[cut] === "\n" || reviewed.text[cut] === "\r")
          cut++;
      }
      const publishedStart = blocks.reduce(
        (total, item) => total + item.text.length + 2,
        0,
      );
      reviewed.certificate.offset = publishedStart;
      reviewed.certificate.publishedRanges = [
        {
          draftStart: cut,
          draftEnd: reviewed.text.length,
          publishedStart,
          publishedEnd: publishedStart + reviewed.text.length - cut,
        },
      ];
      reviewed.text = reviewed.text.slice(cut);
      blocks.push(reviewed);
    }
    const reviewed = {
      text: blocks.map((block) => block.text).join("\n\n"),
      certificates: blocks.map((block) => block.certificate),
    };
    let vector: number[] | undefined;
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
        const [priorProjection] =
          await tx`SELECT descriptor,embedding::text AS embedding,embedding_profile,dimensions FROM wiki_catalogue WHERE page_id=${pageId}`;
        if (
          priorProjection?.embedding &&
          priorProjection.embedding_profile === this.embeddings.profile &&
          Number(priorProjection.dimensions) === this.embeddings.dimensions &&
          descriptorText(priorProjection.descriptor) === descriptorText(topic)
        )
          vector = JSON.parse(String(priorProjection.embedding));
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
