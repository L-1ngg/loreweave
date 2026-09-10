import { WikiDependencies } from "./wiki-dependencies.ts";
import { reviewCurrentSupport } from "./wiki-support.ts";
import { wikiReadiness } from "./wiki-readiness.ts";
import { conflictPacks } from "./wiki-conflicts.ts";
import {
  WikiContributions,
  type ContributionInput,
} from "./wiki-contributions.ts";
import { makePack, packetPacks } from "./wiki-packets.ts";
import { validateExtraction, validateDecision } from "./wiki-validation.ts";
import { WikiProjection } from "./wiki-projection.ts";
import { BackgroundAdmission } from "./background-admission.ts";
import { WikiInspection } from "./wiki-inspection.ts";
import {
  WikiCatalogue,
  normalizeTitle as normalize,
  descriptorText,
} from "./wiki-catalogue.ts";
import { AccessService } from "./access.ts";
import {
  SourceService,
  type SourceVersion,
  type SourceCandidate,
} from "./sources.ts";
import { IdentityService } from "./identity.ts";
import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
import { hash, validateDraft, validateReview } from "./answer-validation.ts";
import { lexicalText } from "./indexing.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import type {
  WikiModel,
  WikiPage,
  WikiPack,
  TopicDescriptor,
  TopicExtraction,
  WikiCertificate,
} from "./wiki-types.ts";
interface PreparedEdit {
  refresh?: {
    inspection: Awaited<ReturnType<WikiInspection["inspect"]>>;
    pageId: string;
    contribution: { versionId: string; topic: TopicDescriptor };
  };
  revisions: Record<string, number>;
  check: (tx: Transaction) => Promise<void>;
  apply: (tx: Transaction) => Promise<void>;
}
/** M05 owns topic publication. Generated prose cannot publish without original-support review. */
export class WikiService {
  private readonly operations: Operations;
  private readonly runtime: WikiModelRuntime;
  private readonly catalogue: WikiCatalogue;
  constructor(
    url: string,
    private readonly access: AccessService,
    private readonly sources: SourceService,
    private readonly identities: IdentityService,
    private readonly embeddings: EmbeddingAdapter,
    private readonly model: WikiModel,
  ) {
    this.operations = new Operations(url);
    this.runtime = new WikiModelRuntime(
      this.operations,
      model,
      new BackgroundAdmission(url),
    );
    this.catalogue = new WikiCatalogue(this.operations, embeddings);
  }
  async list(token: string, projectId?: string, after = "") {
    const context = await this.access.authorize(token, "read", projectId);
    const rows = await this.operations
      .sql`SELECT p.id,p.current_version_id,v.title,e.eligible,p.lifecycle FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id JOIN wiki_version_eligibility e ON e.id=v.id WHERE p.organization_id=${context.organizationId} AND (${projectId ?? null}::uuid IS NULL OR p.project_id IS NULL OR p.project_id=${projectId ?? null}) AND p.id::text>${after} ORDER BY p.id LIMIT 21`;
    return {
      ...(rows.length > 20 ? { next: String(rows[19]!.id) } : {}),
      items: rows.slice(0, 20).map((row) => ({
        id: String(row.id),
        version: String(row.current_version_id),
        title: String(row.title),
        fresh: row.eligible && row.lifecycle === "active",
        lifecycle: String(row.lifecycle),
      })),
    };
  }
  contribute(token: string, input: ContributionInput) {
    return new WikiContributions(
      this.operations,
      this.access,
      this.sources,
    ).submit(token, input);
  }
  guidance(token: string, projectId?: string) {
    return new WikiContributions(
      this.operations,
      this.access,
      this.sources,
    ).guidance(token, projectId);
  }
  repair(
    token: string,
    input: { key: string; operationId: string; guidance: string },
  ) {
    return new WikiContributions(
      this.operations,
      this.access,
      this.sources,
    ).repair(token, input);
  }
  async page(token: string, id: string, version?: string): Promise<WikiPage> {
    const context = await this.access.authorize(token, "read");
    const [row] = await this.operations
      .sql`SELECT p.id,p.current_version_id,p.lifecycle,p.retirement,v.*,e.eligible FROM wiki_pages p JOIN wiki_versions v ON v.page_id=p.id AND v.id=COALESCE(${version ?? null}::uuid,p.current_version_id) JOIN wiki_version_eligibility e ON e.id=v.id WHERE p.id=${id} AND p.organization_id=${context.organizationId}`;
    if (!row) throw new Error("not_found");
    return {
      id,
      version: String(row.id),
      title: String(row.title),
      text: String(row.body),
      fresh:
        row.eligible &&
        row.lifecycle === "active" &&
        row.id === row.current_version_id,
      lifecycle: String(row.lifecycle),
      sources: row.sources,
      certificates: row.certificates,
      descriptor: row.descriptor,
      ...(row.retirement ? { retirement: row.retirement } : {}),
    };
  }
  private async prepareRefresh(
    job: Job,
    index: number | string = 0,
    inspected?: Awaited<ReturnType<WikiInspection["inspect"]>>,
  ): Promise<PreparedEdit> {
    const [page] = await this.operations
      .sql`SELECT p.*,v.descriptor,v.identity_dependencies,v.certificates FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id JOIN knowledge_operations o ON o.organization_id=p.organization_id AND o.id=${job.operationId} WHERE p.id=${String(job.payload.pageId)}`;
    if (!page) throw new Error("not_found");
    if (page.lifecycle === "redirect" || page.lifecycle === "split_entry")
      throw new Error("needs_attention:structural_target");
    const organizationId = String(page.organization_id),
      scope = String(page.project_id ?? "shared");
    const contributions = (job.payload.contributions ?? []) as Array<{
      versionId: string;
      topic: TopicDescriptor;
    }>;
    const refs = await this.operations
      .sql`SELECT DISTINCT s.id,s.active_version_id,s.project_id FROM source_documents s WHERE s.organization_id=${organizationId} AND (s.id IN (SELECT source.document_id FROM wiki_versions v JOIN wiki_version_inputs r ON r.version_id=v.id JOIN source_versions source ON source.id=r.source_version_id WHERE v.page_id=${String(page.id)}) OR s.active_version_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${this.operations.sql.json(contributions.map((item) => item.versionId))}::jsonb)) OR s.id IN (SELECT source.document_id FROM source_notes n JOIN source_versions source ON source.id=n.version_id WHERE n.page_id=${String(page.id)})) ORDER BY s.id`;
    const originals: SourceVersion[] = [];
    for (const ref of refs) {
      if (ref.project_id && ref.project_id !== page.project_id)
        throw new Error("needs_attention:scope_mismatch");
      originals.push(
        await this.sources.maintenanceVersion(
          job.operationId,
          String(ref.active_version_id),
        ),
      );
    }
    for (const contribution of contributions)
      if (
        !originals.some((source) => source.version === contribution.versionId)
      )
        throw new Error("source_changed");
    if (
      job.payload.documentId &&
      job.payload.versionId &&
      !originals.some(
        (source) =>
          source.id === job.payload.documentId &&
          source.version === job.payload.versionId,
      )
    )
      throw new Error("source_changed");
    const descriptor = page.descriptor as TopicDescriptor;
    const identities = await this.identities.maintenanceDependencies(
      job.operationId,
      [
        ...new Set(
          [
            ...descriptor.identities,
            ...contributions.flatMap((item) => item.topic.identities),
          ].map((ref) => ref.mentionId),
        ),
      ],
    );
    const topic = { ...descriptor, identities, handles: [] };
    if (topic.identityRequired && !identities.length)
      throw new Error("needs_attention:unresolved_identity");
    const pack = makePack(job.id, topic.question, originals);
    const revisionSet = hash({
      sources: originals.map((source) => source.version).sort(),
      identities,
      topic: { ...topic, handles: [] },
    });
    const [prior] = await this.operations
      .sql`SELECT * FROM wiki_refresh_results WHERE page_id=${String(page.id)} AND revision_set=${revisionSet} AND version_id=${String(page.current_version_id)} ORDER BY created_at DESC LIMIT 1`;
    const checkInputs = async (tx: Transaction) => {
      if (originals.length) {
        const active =
          await tx`SELECT active_version_id FROM source_documents WHERE organization_id=${organizationId} AND id IN ${tx(originals.map((source) => source.id))} ORDER BY id FOR SHARE`;
        if (
          originals.some(
            (source) =>
              !active.some((row) => row.active_version_id === source.version),
          )
        )
          throw new Error("source_changed");
      }
      await this.sources.assertCurrentForPublication(
        tx,
        organizationId,
        pack.items,
      );
      await this.identities.assertForPublication(
        tx,
        organizationId,
        identities,
      );
      const [current] =
        await tx`SELECT current_version_id FROM wiki_pages WHERE id=${String(page.id)} FOR UPDATE`;
      if (current?.current_version_id !== page.current_version_id)
        throw new Error("version_conflict");
    };
    if (prior)
      return {
        revisions: {},
        check: checkInputs,
        apply: async (tx) => {
          await tx`INSERT INTO wiki_refresh_results(job_id,page_id,revision_set,disposition,version_id) VALUES(${job.id},${String(page.id)},${revisionSet},'coalesced',${String(page.current_version_id)}) ON CONFLICT(job_id,page_id) DO NOTHING`;
        },
      };
    await this.operations.checkpoint(job, async (tx) => {
      await tx`INSERT INTO wiki_work(job_id) VALUES(${job.id}) ON CONFLICT DO NOTHING`;
    });
    const inspector = new WikiInspection(
      this.operations,
      this.sources,
      this.runtime,
    );
    const inspection =
      inspected ??
      (await inspector.inspect(
        job,
        index,
        topic,
        [
          {
            id: String(page.id),
            version: String(page.current_version_id),
            title: topic.title,
            descriptor: topic,
            fresh: false,
            ...(page.project_id ? { projectId: String(page.project_id) } : {}),
          },
        ],
        packetPacks(pack, 4000)[0] ?? { ...pack, items: [] },
      ));
    const supported = await reviewCurrentSupport(
      this.operations,
      this.runtime,
      job,
      topic,
      pack,
      String(page.current_version_id),
      scope,
      page.certificates as WikiCertificate[],
      `support:${index}`,
    );
    const check = async (tx: Transaction) => {
      await checkInputs(tx);
      await inspector.assertCurrent(tx, organizationId, inspection);
    };
    const edit = supported.items.length
      ? await this.prepareContent(
          job,
          organizationId,
          scope,
          topic,
          supported,
          index,
          {},
          check,
          { id: String(page.id), version: String(page.current_version_id) },
        )
      : undefined;
    return {
      revisions: {},
      check,
      apply: async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${organizationId}`},0))`;
        if (edit) await edit.apply(tx);
        else {
          await tx`UPDATE wiki_pages SET lifecycle='retired',retirement=${tx.json({ reason: "no_current_support", at: new Date().toISOString(), operationId: job.operationId })} WHERE id=${String(page.id)}`;
          await tx`INSERT INTO wiki_catalogue_scopes(organization_id,scope,revision) VALUES(${organizationId},${scope},1) ON CONFLICT(organization_id,scope) DO UPDATE SET revision=wiki_catalogue_scopes.revision+1`;
        }
        const [current] =
          await tx`SELECT current_version_id FROM wiki_pages WHERE id=${String(page.id)}`;
        if (edit)
          for (const source of originals)
            await tx`INSERT INTO wiki_version_inputs(version_id,source_version_id) VALUES(${String(current!.current_version_id)},${source.version}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO wiki_refresh_results(job_id,page_id,revision_set,disposition,version_id) VALUES(${job.id},${String(page.id)},${revisionSet},${edit ? "published" : "retired"},${String(current!.current_version_id)})`;
      },
    };
  }
  async workOne(token?: string): Promise<boolean> {
    const context = token
      ? await this.access.authorize(token, "import")
      : undefined;
    const projection = new WikiProjection(this.operations, this.embeddings);
    const dependencies = new WikiDependencies(this.operations);
    await dependencies.supersede(context?.organizationId);
    await projection.wake(context?.organizationId);
    const job = await this.operations.claim(
      [
        "wiki.refresh",
        "wiki.project",
        "wiki.dependencies",
        "wiki.revalidate",
        "wiki.identity",
      ],
      600000,
      context?.organizationId,
      await dependencies.readyJobs(context?.organizationId),
    );
    if (!job) return false;
    try {
      if (job.kind === "wiki.dependencies" || job.kind === "wiki.identity") {
        await new WikiDependencies(this.operations).run(job);
        return true;
      }
      if (job.kind === "wiki.project") {
        await projection.run(job);
        return true;
      }
      if (job.kind === "wiki.revalidate") {
        for (let attempt = 0; attempt < 3; attempt++)
          try {
            const edit = await this.prepareRefresh(job);
            await this.operations.commit(job, async (tx) => {
              await edit.check(tx);
              await edit.apply(tx);
            });
            return true;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "version_conflict"
            )
              throw error;
          }
        throw new Error("needs_attention:page_conflict");
      }
      const source = await this.sources.maintenanceVersion(
        job.operationId,
        String(job.payload.versionId),
      );
      if (source.version !== source.currentVersionId)
        throw new Error("source_changed");
      const [owner] = await this.operations
        .sql`SELECT organization_id FROM knowledge_operations WHERE id=${job.operationId}`;
      const organizationId = String(owner!.organization_id),
        scope = source.projectId ?? "shared";
      const pack = makePack(job.id, source.title, [source]);
      const extraction: TopicExtraction = { topics: [], coverage: [] };
      for (const [packetIndex, packet] of packetPacks(pack, 4000).entries()) {
        const extracted: TopicExtraction = { topics: [], coverage: [] };
        let remaining = packet;
        for (let child = 0; child < 4; child++) {
          const part = await this.runtime.request(
            job,
            `packet:${packetIndex}:child:${child}`,
            "extraction",
            2,
            { pack: remaining },
            (raw) => validateExtraction(raw, remaining),
          );
          const offset = extracted.topics.length;
          extracted.topics.push(...part.topics);
          const resolved = part.coverage.filter(
            (entry) => entry.outcome !== "unresolved",
          );
          extracted.coverage.push(
            ...resolved.map((entry) => ({
              ...entry,
              topicIndexes: entry.topicIndexes.map((i) => i + offset),
            })),
          );
          const pending = part.coverage.filter(
            (entry) => entry.outcome === "unresolved",
          );
          const items = remaining.items.filter((item) =>
            pending.some((entry) => entry.handle === item.handle),
          );
          await this.operations.checkpoint(job, async (tx) => {
            await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [`packet:${packetIndex}`]: { children: child + 1, coverage: extracted.coverage, remaining: items.map((item) => ({ handle: item.handle, version: item.version, passageId: item.passageId, start: item.start, end: item.end })) } }))}::jsonb WHERE job_id=${job.id}`;
          });
          if (!items.length) break;
          if (items.length === remaining.items.length || child === 3) {
            extracted.coverage.push(
              ...pending.map((entry) => ({
                ...entry,
                topicIndexes: entry.topicIndexes.map((i) => i + offset),
              })),
            );
            break;
          }
          remaining = { ...packet, items, hash: hash(items) };
        }
        const remap = extracted.topics.map((topic) => {
          const previous = extraction.topics.findIndex(
            (other) =>
              other.subjectKey === topic.subjectKey &&
              other.aspectKey === topic.aspectKey &&
              hash(other.identities) === hash(topic.identities),
          );
          if (previous < 0) {
            extraction.topics.push(topic);
            return extraction.topics.length - 1;
          }
          extraction.topics[previous]!.handles = [
            ...new Set([
              ...extraction.topics[previous]!.handles,
              ...topic.handles,
            ]),
          ];
          return previous;
        });
        extraction.coverage.push(
          ...extracted.coverage.map((entry) => ({
            ...entry,
            topicIndexes: entry.topicIndexes.map((i) => remap[i]!),
          })),
        );
        await this.operations.checkpoint(job, async (tx) => {
          await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ coverage: extraction.coverage, remaining: pack.items.filter((item) => !extraction.coverage.some((entry) => entry.handle === item.handle)).map((item) => ({ handle: item.handle, version: item.version, passageId: item.passageId, start: item.start, end: item.end })) }))}::jsonb WHERE job_id=${job.id}`;
        });
      }
      if (extraction.coverage.some((item) => item.outcome === "unresolved"))
        throw new Error("needs_attention:source_coverage");
      let published = false;
      for (let attempt = 0; attempt < 3 && !published; attempt++) {
        const edits: PreparedEdit[] = [];
        for (const [index, topic] of extraction.topics.entries()) {
          const edit = await this.planAndPublish(
            job,
            organizationId,
            scope,
            source,
            topic,
            index,
          );
          if (edit) edits.push(edit);
        }
        const grouped = new Map<
          string,
          Array<{ versionId: string; topic: TopicDescriptor }>
        >();
        for (const edit of edits)
          if (edit.refresh)
            grouped.set(edit.refresh.pageId, [
              ...(grouped.get(edit.refresh.pageId) ?? []),
              edit.refresh.contribution,
            ]);
        for (const [pageId, contributions] of grouped)
          edits.push(
            await this.prepareRefresh(
              { ...job, payload: { ...job.payload, pageId, contributions } },
              `refresh:${pageId}`,
              edits.find((edit) => edit.refresh?.pageId === pageId)!.refresh!
                .inspection,
            ),
          );
        try {
          await this.operations.commit(job, async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${organizationId}`},0))`;
            const revisions =
              await tx`SELECT scope,revision FROM wiki_catalogue_scopes WHERE organization_id=${organizationId}`;
            for (const edit of edits)
              if (
                Object.entries(edit.revisions).some(
                  ([key, value]) =>
                    Number(
                      revisions.find((row) => row.scope === key)?.revision ?? 0,
                    ) !== Number(value),
                )
              )
                throw new Error("version_conflict");
            for (const edit of edits) await edit.check(tx);
            for (const edit of edits) await edit.apply(tx);
            await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ coverage: extraction.coverage }))}::jsonb WHERE job_id=${job.id}`;
          });
          published = true;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "version_conflict")
            throw error;
        }
      }
      if (!published) throw new Error("needs_attention:catalogue_conflict");
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "maintenance_failed";
      if (reason === "stale_worker") throw error;
      await this.operations.commit(
        job,
        async (tx) => {
          await tx`UPDATE knowledge_jobs SET reason=${reason} WHERE id=${job.id}`;
        },
        reason === "source_changed" || reason === "identity_changed"
          ? "superseded"
          : reason === "needs_attention:catalogue_unavailable"
            ? "retry_wait"
            : "failed",
      );
    }
    return true;
  }
  private async planAndPublish(
    job: Job,
    organizationId: string,
    scope: string,
    source: SourceVersion,
    topic: TopicDescriptor,
    index: number | string,
  ): Promise<PreparedEdit | undefined> {
    const assignedContribution = makePack(job.id, topic.question, [source]);
    assignedContribution.items = assignedContribution.items.filter((item) =>
      topic.handles.includes(item.handle),
    );
    const planningPack = packetPacks(assignedContribution, 4000)[0];
    if (!planningPack) throw new Error("needs_attention:unsupported_topic");
    const routingTopic = {
      ...topic,
      handles: planningPack.items.map((item) => item.handle),
    };
    await this.operations.checkpoint(job, async (tx) => {
      await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [`planning-context:${index}`]: { included: planningPack.items.map((item) => item.handle), additionalAssignedRanges: assignedContribution.items.filter((item) => !planningPack.items.some((included) => included.handle === item.handle)).map((item) => ({ handle: item.handle, passageId: item.passageId, start: item.start, end: item.end })) } }))}::jsonb WHERE job_id=${job.id}`;
    });
    const entities = await this.operations.checkpoint(job, (tx) =>
      this.identities.assertForPublication(
        tx,
        organizationId,
        topic.identities,
      ),
    );
    const pool = await this.catalogue.find(
      organizationId,
      scope,
      topic,
      AbortSignal.timeout(45000),
      entities,
    );
    const candidates = pool.cards;
    let cards = candidates.slice(0, 8);
    const admitCards = () =>
      this.operations.checkpoint(job, async (tx) => {
        const [work] =
          await tx`SELECT state FROM wiki_work WHERE job_id=${job.id}`;
        const selected = [
          ...new Set<string>([
            ...(work!.state[`selected:${index}`] ?? []),
            ...cards.map((card) => card.id),
          ]),
        ];
        if (selected.length > 16) throw new Error("needs_attention:card_limit");
        await tx`UPDATE wiki_work SET state=state||${tx.json({ [`selected:${index}`]: selected })}::jsonb WHERE job_id=${job.id}`;
      });
    await admitCards();
    let decision = await this.runtime.request(
      job,
      `topic:${index}`,
      "planning",
      3,
      {
        topic: routingTopic,
        scope,
        catalogueRevisions: pool.scopeRevisions,
        candidates: cards,
        pack: planningPack,
      },
      (raw) => validateDecision(raw, cards, planningPack),
    );
    if (decision.action === "create" || decision.action === "defer") {
      if (candidates.length > cards.length) {
        cards = candidates.slice(0, 16);
        await admitCards();
        decision = await this.runtime.request(
          job,
          `topic:${index}`,
          "planning",
          3,
          {
            topic: routingTopic,
            scope,
            catalogueRevisions: pool.scopeRevisions,
            candidates: cards,
            pack: planningPack,
            expanded: true,
          },
          (raw) => validateDecision(raw, cards, planningPack),
        );
      }
    }
    await this.operations.checkpoint(job, async (tx) => {
      await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ [`topic:${index}`]: { pool: pool.cards.map((card) => card.id), ranks: pool.ranks, inspected: cards.map((card) => card.id), unavailable: pool.unavailable, routeTotals: pool.routeTotals, truncated: pool.truncated, decision } }))}::jsonb WHERE job_id=${job.id}`;
    });
    await this.operations.checkpoint(job, async (tx) => {
      const [work] =
        await tx`SELECT state FROM wiki_work WHERE job_id=${job.id}`;
      const selected = [
        ...new Set<string>([
          ...(work!.state[`selected:${index}`] ?? []),
          ...cards.map((card) => card.id),
        ]),
      ];
      if (selected.length > 16) throw new Error("needs_attention:card_limit");
      await tx`UPDATE wiki_work SET state=state||${tx.json({ [`selected:${index}`]: selected })}::jsonb WHERE job_id=${job.id}`;
    });
    if (
      decision.action === "create" &&
      pool.count > 0 &&
      pool.unavailable.length
    ) {
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE wiki_work SET state=state||${tx.json(jsonValue({ waitRevisions: pool.scopeRevisions, wake: "catalogue_projection_or_revision" }))}::jsonb WHERE job_id=${job.id}`;
      });
      throw new Error("needs_attention:catalogue_unavailable");
    }
    if (decision.action === "defer")
      throw new Error(`needs_attention:${decision.reason}`);
    const inspector = new WikiInspection(
      this.operations,
      this.sources,
      this.runtime,
    );
    const inspection = await inspector.inspect(
      job,
      index,
      topic,
      decision.pageId
        ? cards.filter((card) => card.id === decision.pageId)
        : cards.slice(0, 3),
      planningPack,
    );
    if (cards.length) {
      decision = await this.runtime.request(
        job,
        `topic:${index}`,
        "planning",
        3,
        {
          topic: routingTopic,
          scope,
          catalogueRevisions: pool.scopeRevisions,
          candidates: cards,
          pack: planningPack,
          inspection: inspector.planningContext(inspection),
        },
        (raw) => validateDecision(raw, cards, planningPack),
      );
      if (decision.pageId && !inspection.pages.includes(decision.pageId))
        throw new Error("needs_attention:uninspected_target");
      if (decision.action === "defer")
        throw new Error(`needs_attention:${decision.reason}`);
      await this.operations.checkpoint(job, async (tx) => {
        await tx`UPDATE wiki_work SET state=jsonb_set(state,ARRAY[${`topic:${index}`},'decision'],${tx.json(jsonValue(decision))}::jsonb) WHERE job_id=${job.id}`;
      });
    }
    if (
      decision.action === "create" &&
      (cards.length < Math.min(16, candidates.length) ||
        (pool.count > 0 && pool.unavailable.length))
    )
      throw new Error("needs_attention:incomplete_novelty_inspection");
    await this.operations.checkpoint(job, async (tx) => {
      const decisionKey = `${job.id}:topic:${index}`;
      await tx`DELETE FROM wiki_structure_proposals WHERE operation_id=${job.operationId} AND decision_key=${decisionKey}`;
      for (const proposal of decision.proposals ?? [])
        await tx`INSERT INTO wiki_structure_proposals(id,operation_id,organization_id,kind,page_ids,reason,input_hash,decision_key) VALUES(${crypto.randomUUID()},${job.operationId},${organizationId},${proposal.kind},${tx.json(proposal.pageIds)},${proposal.reason},${hash({ topic, proposal })},${decisionKey}) ON CONFLICT DO NOTHING`;
    });
    if (decision.action === "link" || decision.action === "no_change") {
      if (planningPack.items.length !== assignedContribution.items.length)
        throw new Error("needs_attention:uninspected_contribution");
      const target = cards.find((card) => card.id === decision.pageId)!;
      if (
        decision.action === "no_change" &&
        !target.fresh &&
        (target.projectId ?? "shared") === scope
      )
        return {
          refresh: {
            inspection,
            pageId: target.id,
            contribution: { versionId: source.version, topic },
          },
          revisions: pool.scopeRevisions,
          check: (tx) =>
            inspector.assertCurrent(tx, organizationId, inspection),
          apply: async (tx) => {
            await this.sources.assertCurrentForPublication(
              tx,
              organizationId,
              assignedContribution.items,
            );
          },
        };
      if (!target.fresh) throw new Error("needs_attention:target_not_current");
      return {
        revisions: pool.scopeRevisions,
        check: (tx) => inspector.assertCurrent(tx, organizationId, inspection),
        apply: async (tx) => {
          await this.sources.assertCurrentForPublication(
            tx,
            organizationId,
            makePack(job.id, topic.question, [source]).items,
          );
          await this.identities.assertForPublication(
            tx,
            organizationId,
            topic.identities,
          );
          const [page] =
            await tx`SELECT p.current_version_id,v.sources,v.identity_dependencies FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id WHERE p.id=${target.id} AND p.organization_id=${organizationId} FOR SHARE OF p`;
          if (page?.current_version_id !== target.version)
            throw new Error("version_conflict");
          await this.sources.assertCurrentForPublication(
            tx,
            organizationId,
            page.sources,
          );
          await this.identities.assertForPublication(
            tx,
            organizationId,
            page.identity_dependencies,
          );
          if (decision.action === "link")
            await tx`INSERT INTO wiki_navigation(organization_id,scope,target_page_id,source_version_id,operation_id) VALUES(${organizationId},${scope},${target.id},${source.version},${job.operationId}) ON CONFLICT DO NOTHING`;
        },
      };
    }
    const existing = decision.pageId
      ? candidates.find((row) => row.id === decision.pageId)
      : undefined;
    if (existing && (existing.projectId ?? "shared") !== scope)
      throw new Error("needs_attention:scope_mismatch");
    if (existing)
      return {
        refresh: {
          inspection,
          pageId: existing.id,
          contribution: { versionId: source.version, topic },
        },
        revisions: pool.scopeRevisions,
        check: (tx) => inspector.assertCurrent(tx, organizationId, inspection),
        apply: async (tx) => {
          await this.sources.assertCurrentForPublication(
            tx,
            organizationId,
            assignedContribution.items,
          );
        },
      };
    return this.prepareContent(
      job,
      organizationId,
      scope,
      topic,
      assignedContribution,
      index,
      pool.scopeRevisions,
      (tx) => inspector.assertCurrent(tx, organizationId, inspection),
    );
  }
  private async prepareContent(
    job: Job,
    organizationId: string,
    scope: string,
    topic: TopicDescriptor,
    pack: WikiPack,
    index: number | string,
    revisions: Record<string, number>,
    check: (tx: Transaction) => Promise<void>,
    existing?: { id: string; version: string },
  ): Promise<PreparedEdit> {
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
        AbortSignal.timeout(45000),
      );
      validateEmbeddings(vectors, 1, this.embeddings.dimensions);
      vector = vectors[0];
    } catch {
      // The required lexical catalogue publishes even when its optional vector projection is pending.
    }
    return {
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
        const pageId = existing ? String(existing.id) : crypto.randomUUID(),
          versionId = crypto.randomUUID();
        if (existing) {
          const [page] =
            await tx`SELECT current_version_id FROM wiki_pages WHERE id=${pageId} FOR UPDATE`;
          if (page?.current_version_id !== existing.version)
            throw new Error("version_conflict");
        } else {
          const [duplicate] =
            await tx`SELECT c.page_id FROM wiki_catalogue c JOIN wiki_pages p ON p.id=c.page_id WHERE p.organization_id=${organizationId} AND COALESCE(p.project_id::text,'shared')=${scope} AND (EXISTS(SELECT 1 FROM jsonb_array_elements_text(${tx.json([topic.title, ...topic.aliases].map(normalize))}::jsonb) name WHERE c.normalized_title=name.value OR c.aliases ? name.value) OR (c.subject_key=${topic.subjectKey} AND c.aspect_key=${topic.aspectKey}))`;
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
  async retryProjection(token: string, pageId: string, key: string) {
    const context = await this.access.authorize(token, "import"),
      inputHash = hash({ pageId, profile: this.embeddings.profile });
    const prior = await this.operations.lookup(context, key, inputHash);
    if (prior) return prior;
    const page = await this.page(token, pageId);
    return this.operations.accept(
      context,
      key,
      inputHash,
      async (tx, operationId) => {
        await this.operations.enqueue(
          tx,
          operationId,
          "wiki.project",
          { pageId, versionId: page.version },
          page.version,
        );
      },
    );
  }
  async search(
    token: string,
    input: { question: string; projectId?: string; signal: AbortSignal },
  ): Promise<{
    pages: number;
    originals: SourceCandidate[];
    truncated?: boolean;
  }> {
    const context = await this.access.authorize(token, "read", input.projectId);
    const query = lexicalText(input.question)
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `'${term.replaceAll("'", "''")}'`)
      .join(" | ");
    if (!query) return { pages: 0, originals: [] };
    const sql = this.operations.sql;
    const statement = sql`SELECT p.id,v.sources FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id JOIN wiki_catalogue c ON c.page_id=p.id AND c.version_id=v.id JOIN wiki_version_eligibility e ON e.id=v.id WHERE p.organization_id=${context.organizationId} AND p.lifecycle='active' AND e.eligible AND (${input.projectId ?? null}::uuid IS NULL OR p.project_id IS NULL OR p.project_id=${input.projectId ?? null}) AND (c.lexical||c.body_search) @@ to_tsquery('simple',${query}) ORDER BY ts_rank_cd(c.lexical||c.body_search,to_tsquery('simple',${query})) DESC,p.id LIMIT 20`;
    const cancel = () => statement.cancel();
    input.signal.addEventListener("abort", cancel, { once: true });
    try {
      input.signal.throwIfAborted();
      const rows = await statement;
      input.signal.throwIfAborted();
      const references = new Map<
        string,
        { version: string; passageId: string }
      >();
      for (const row of rows)
        for (const ref of row.sources) {
          const key = `${ref.version}:${ref.passageId}`;
          if (!references.has(key))
            references.set(key, {
              version: String(ref.version),
              passageId: String(ref.passageId),
            });
        }
      const originals = await this.sources.resolveCurrent(token, {
        references: [...references.values()].slice(0, 50),
        signal: input.signal,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
      return { pages: rows.length, originals, truncated: references.size > 50 };
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }
  async navigation(token: string, projectId?: string) {
    const context = await this.access.authorize(token, "read", projectId);
    const rows = await this.operations
      .sql`SELECT n.target_page_id,v.title,n.source_version_id,p.lifecycle,e.eligible FROM wiki_navigation n JOIN wiki_pages p ON p.id=n.target_page_id JOIN wiki_versions v ON v.id=p.current_version_id JOIN wiki_version_eligibility e ON e.id=v.id WHERE n.organization_id=${context.organizationId} AND n.scope=${projectId ?? "shared"} AND p.lifecycle='active' ORDER BY n.target_page_id,n.source_version_id`;
    return {
      items: rows.map((row) => ({
        pageId: String(row.target_page_id),
        title: String(row.title),
        sourceVersion: String(row.source_version_id),
        fresh: row.eligible && row.lifecycle === "active",
      })),
    };
  }
  async inspect(token: string, operationId: string) {
    const context = await this.access.authorize(token, "read");
    const [owner] = await this.operations
      .sql`SELECT id FROM knowledge_operations WHERE id=${operationId} AND organization_id=${context.organizationId}`;
    if (!owner) throw new Error("not_found");
    const jobs = await this.operations
      .sql`SELECT j.id,j.kind,j.state,j.reason,j.payload,w.state AS ledger,w.deadline FROM knowledge_jobs j LEFT JOIN wiki_work w ON w.job_id=j.id WHERE j.operation_id=${operationId} AND j.kind IN ('wiki.refresh','wiki.revalidate') ORDER BY j.id`;
    const proposals = await this.operations
      .sql`SELECT id,kind,page_ids,reason FROM wiki_structure_proposals WHERE operation_id=${operationId} ORDER BY id`;
    const stages = await this.operations
      .sql`SELECT kind,state FROM knowledge_jobs WHERE operation_id=${operationId}`;
    const results = await this.operations
      .sql`SELECT DISTINCT ON(r.page_id) r.* FROM wiki_refresh_results r JOIN knowledge_jobs j ON j.id=r.job_id WHERE j.operation_id=${operationId} ORDER BY r.page_id,(r.disposition='coalesced'),r.created_at DESC`;
    const walks = await this.operations
      .sql`SELECT w.* FROM wiki_dependency_walks w JOIN knowledge_jobs j ON j.id=w.job_id WHERE j.operation_id=${operationId} ORDER BY w.job_id`;
    return {
      status: wikiReadiness(
        stages.map((row) => ({
          kind: String(row.kind),
          state: String(row.state),
        })),
      ),
      pages: results.map((row) => ({
        pageId: String(row.page_id),
        version: String(row.version_id),
        disposition: String(row.disposition),
      })),
      walks: walks.map((row) => ({
        jobId: String(row.job_id),
        cursor: String(row.cursor),
        complete: Boolean(row.complete),
        pageIds: row.page_ids as string[],
        batchSizes: row.batch_sizes as number[],
      })),
      proposals: proposals.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        pageIds: row.page_ids as string[],
        reason: String(row.reason),
      })),
      jobs: jobs.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        pageId: row.payload.pageId as string | undefined,
        state: String(row.state),
        reason: row.reason,
        ledger: row.ledger ?? {},
        deadline: row.deadline,
      })),
    };
  }
  async close() {
    await this.operations.close();
  }
}
