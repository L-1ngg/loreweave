import { AccessService } from "./access.ts";
import { hash } from "./answer-validation.ts";
import { IdentityService } from "./identity.ts";
import { Operations, jsonValue, type Job } from "./operations.ts";
import { SourceService } from "./sources.ts";
import {
  copyWikiVersion,
  pageState,
  recordPageEdit,
} from "./wiki-edit-history.ts";
import { WikiModelRuntime } from "./wiki-model-runtime.ts";
import { WikiPublication, type ContentEdit } from "./wiki-publication.ts";
import {
  structureClaims,
  validateStructure,
  validateStructureReview,
  validateStructureCoverage,
  type StructurePage,
} from "./wiki-structure-validation.ts";
import type { TopicDescriptor, WikiPack } from "./wiki-types.ts";

export interface RestructureInput {
  key: string;
  kind: "merge" | "split";
  pages: Array<{ pageId: string; version: string }>;
  reason: string;
}
/** Recorded proposals are instructions to inspect current evidence, never authority to change it. */
export class WikiStructure {
  constructor(
    private readonly operations: Operations,
    private readonly access: AccessService,
    private readonly sources: SourceService,
    private readonly identities: IdentityService,
    private readonly runtime: WikiModelRuntime,
    private readonly publication: WikiPublication,
  ) {}

  async submit(token: string, input: RestructureInput) {
    const context = await this.access.authorize(token, "correct");
    if (
      !["merge", "split"].includes(input.kind) ||
      !input.reason.trim() ||
      new TextEncoder().encode(input.reason).length > 1000 ||
      new Set(input.pages.map((page) => page.pageId)).size !==
        input.pages.length ||
      (input.kind === "merge"
        ? input.pages.length < 2 || input.pages.length > 3
        : input.pages.length !== 1)
    )
      throw new Error("invalid_input");
    const inputHash = hash({ operation: "wiki.structure", ...input });
    const prior = await this.operations.lookup(context, input.key, inputHash);
    if (prior) return { status: "accepted" as const, operationId: prior };
    const pages = await this.operations
      .sql`SELECT id,current_version_id,lifecycle,project_id FROM wiki_pages WHERE organization_id=${context.organizationId} AND id IN ${this.operations.sql(input.pages.map((page) => page.pageId))} ORDER BY id`;
    if (pages.length !== input.pages.length) throw new Error("not_found");
    if (
      pages.some(
        (page) =>
          page.current_version_id !==
            input.pages.find((ref) => ref.pageId === page.id)?.version ||
          page.lifecycle !== "active",
      )
    )
      return {
        status: "clarification" as const,
        reason: "page_changed",
        pages: pages.map((page) => ({
          pageId: String(page.id),
          version: String(page.current_version_id),
        })),
      };
    if (new Set(pages.map((page) => page.project_id)).size !== 1)
      return {
        status: "clarification" as const,
        reason: "different_applicability",
        pages: [],
      };
    const operationId = await this.operations.accept(
      context,
      input.key,
      inputHash,
      async (tx, id) => {
        const proposalId = crypto.randomUUID();
        await tx`INSERT INTO wiki_structure_proposals(id,operation_id,organization_id,kind,page_ids,reason,input_hash,input_manifest) VALUES(${proposalId},${id},${context.organizationId},${input.kind},${tx.json(input.pages.map((page) => page.pageId))},${input.reason},${inputHash},${tx.json({ requestedPages: input.pages, explicit: true })})`;
        await this.operations.enqueue(
          tx,
          id,
          "wiki.structure",
          { proposalId },
          proposalId,
        );
      },
    );
    return { status: "accepted" as const, operationId };
  }

  async queueRecorded(organizationId?: string) {
    const proposals = await this.operations
      .sql`SELECT p.* FROM wiki_structure_proposals p WHERE p.status='pending' AND (${organizationId ?? null}::uuid IS NULL OR p.organization_id=${organizationId ?? null}) AND NOT EXISTS(SELECT 1 FROM knowledge_jobs j WHERE j.kind='wiki.structure' AND j.job_key=p.id::text) AND NOT EXISTS(SELECT 1 FROM knowledge_jobs j WHERE j.operation_id=p.operation_id AND j.kind IN ('wiki.refresh','wiki.dependencies','wiki.revalidate','wiki.identity') AND j.state NOT IN ('succeeded','superseded')) ORDER BY p.id LIMIT 20`;
    for (const proposal of proposals)
      await this.operations
        .sql`INSERT INTO knowledge_jobs(id,operation_id,kind,job_key,payload) VALUES(${crypto.randomUUID()},${String(proposal.operation_id)},'wiki.structure',${String(proposal.id)},${this.operations.sql.json({ proposalId: String(proposal.id) })}) ON CONFLICT(operation_id,kind,job_key) DO NOTHING`;
  }

  async run(job: Job) {
    const [proposal] = await this.operations
      .sql`SELECT p.* FROM wiki_structure_proposals p JOIN knowledge_operations o ON o.id=${job.operationId} AND o.organization_id=p.organization_id WHERE p.id=${String(job.payload.proposalId)}`;
    if (!proposal) throw new Error("not_found");
    if (proposal.status !== "pending") {
      await this.operations.commit(job, async () => {});
      return;
    }
    const org = String(proposal.organization_id),
      kind = proposal.kind as "merge" | "split",
      ids = proposal.page_ids as string[];
    if (
      (kind === "merge"
        ? ids.length < 2 || ids.length > 3
        : ids.length !== 1) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("needs_attention:structure_page_limit");
    const rows = await this.operations
      .sql`SELECT p.id,p.current_version_id,p.lifecycle,p.project_id,v.descriptor,v.sources,v.certificates,v.identity_dependencies,e.eligible,COALESCE((SELECT jsonb_agg(source_version_id ORDER BY source_version_id) FROM wiki_version_inputs WHERE version_id=v.id),'[]'::jsonb) AS inputs FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id JOIN wiki_version_eligibility e ON e.id=v.id WHERE p.organization_id=${org} AND p.id IN ${this.operations.sql(ids)} ORDER BY p.created_at,p.id`;
    if (rows.length !== ids.length) throw new Error("not_found");
    const requested = proposal.input_manifest?.requestedPages as
      RestructureInput["pages"] | undefined;
    if (
      requested &&
      rows.some(
        (row) =>
          requested.find((ref) => ref.pageId === row.id)?.version !==
          row.current_version_id,
      )
    )
      throw new Error("clarification:page_changed");
    if (rows.some((row) => row.lifecycle !== "active" || !row.eligible))
      throw new Error("needs_attention:structure_target_not_current");
    if (new Set(rows.map((row) => row.project_id)).size !== 1)
      throw new Error("needs_attention:scope_mismatch");
    const scope = String(rows[0]!.project_id ?? "shared");
    const revisions = await this.operations
      .sql`SELECT scope,revision FROM wiki_catalogue_scopes WHERE organization_id=${org} AND scope IN ('shared',${scope})`;
    const pages: StructurePage[] = rows.map((row) => ({
      id: String(row.id),
      version: String(row.current_version_id),
      projectId: row.project_id,
      descriptor: row.descriptor,
      sources: row.sources,
      certificates: row.certificates,
      inputs: row.inputs,
    }));
    const refs = pages
      .flatMap((page) => page.sources)
      .filter(
        (ref, index, all) =>
          all.findIndex(
            (other) =>
              other.version === ref.version &&
              other.passageId === ref.passageId &&
              other.start === ref.start &&
              other.end === ref.end,
          ) === index,
      )
      .map((item, index) => ({ ...item, handle: `s${index + 1}` }));
    const pack: WikiPack = {
      runId: job.id,
      question: String(proposal.reason),
      items: refs,
      hash: hash(refs),
      diagnostics: {
        lexicalCandidates: 0,
        vectorCandidates: 0,
        retrievalMs: 0,
        embeddingRequests: 0,
        gaps: [],
      },
    };
    const guidance = await this.operations
      .sql`SELECT g.id,g.body,EXISTS(SELECT 1 FROM knowledge_jobs j WHERE j.operation_id=g.operation_id AND j.kind='wiki.restore') AS restoration FROM wiki_guidance g WHERE g.organization_id=${org} AND (g.project_id IS NULL OR g.project_id::text=${scope}) AND (g.page_id IS NULL OR g.page_id IN ${this.operations.sql(ids)}) ORDER BY g.id`;
    const decisionHash = hash({
      kind,
      pages: ids.toSorted(),
      sources: [...new Set(pages.flatMap((page) => page.inputs))].sort(),
      identities: pages.flatMap((page) => page.descriptor.identities),
      guidance: guidance.filter((row) => !row.restoration).map((row) => row.id),
    });
    const [rejected] = await this.operations
      .sql`SELECT id FROM wiki_structure_proposals WHERE organization_id=${org} AND decision_hash=${decisionHash} AND status IN ('rejected','reversed') LIMIT 1`;
    if (rejected && !proposal.input_manifest?.explicit) {
      await this.operations.commit(job, async (tx) => {
        await tx`UPDATE wiki_structure_proposals SET status='suppressed',decision_hash=${decisionHash} WHERE id=${String(proposal.id)}`;
      });
      return;
    }
    const claims = structureClaims(pages, pack);
    const manifest = {
      pages: pages.map((page) => ({
        id: page.id,
        version: page.version,
        descriptor: page.descriptor,
        inputs: page.inputs,
      })),
      catalogue: revisions.map((row) => ({
        scope: String(row.scope),
        revision: Number(row.revision),
      })),
      evidenceHash: pack.hash,
    };
    await this.operations.checkpoint(job, async (tx) => {
      await tx`UPDATE wiki_structure_proposals SET decision_hash=${decisionHash},input_manifest=COALESCE(input_manifest,'{}'::jsonb)||${tx.json(jsonValue(manifest))}::jsonb WHERE id=${String(proposal.id)}`;
    });
    const plan = await this.runtime.request(
      job,
      "structure",
      "structure",
      3,
      {
        kind,
        pages: manifest.pages,
        claims,
        pack,
        scope,
        reason: proposal.reason,
        guidance: guidance.map((row) => ({
          id: String(row.id),
          text: String(row.body),
        })),
      },
      (raw) => validateStructure(raw, kind, pages, claims, pack),
    );
    await this.runtime.request(
      job,
      "structure",
      "structure_review",
      3,
      { plan, planHash: hash(plan), pages: manifest.pages, claims, pack },
      (raw) => validateStructureReview(raw, plan, claims, pack),
    );
    const edits: ContentEdit[] = [];
    for (const [index, successor] of plan.successors.entries()) {
      const items = pack.items.filter((item) =>
        successor.topic.handles.includes(item.handle),
      );
      edits.push(
        await this.publication.prepare(
          job,
          org,
          scope,
          successor.topic,
          { ...pack, items, hash: hash(items) },
          `structure:${index}`,
          {},
          async () => {},
          kind === "merge"
            ? { id: pages[0]!.id, version: pages[0]!.version }
            : undefined,
        ),
      );
    }
    const published = edits.map((edit) => ({
      pageId: edit.pageId,
      text: edit.reviewed.text,
      claims: edit.reviewed.certificates.flatMap((certificate, index) =>
        certificate.draft.claims.map((claim) => ({
          id: `${index}:${claim.id}`,
          text: certificate.draft.text.slice(claim.start, claim.end),
          handles: claim.handles,
        })),
      ),
    }));
    await this.runtime.request(
      job,
      "structure",
      "structure_review",
      3,
      {
        stage: "publication",
        plan,
        planHash: hash(plan),
        claims,
        pack,
        published,
      },
      (raw) => validateStructureCoverage(raw, plan, claims, pack, published),
    );
    await this.operations.commit(job, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${org}`},0))`;
      const latest =
        await tx`SELECT scope,revision FROM wiki_catalogue_scopes WHERE organization_id=${org} AND scope IN ('shared',${scope})`;
      if (
        hash(latest.map((row) => [row.scope, Number(row.revision)]).sort()) !==
        hash(revisions.map((row) => [row.scope, Number(row.revision)]).sort())
      )
        throw new Error("needs_attention:catalogue_changed");
      const canonicalSubjects: string[][] = [];
      const before = new Map<
        string,
        NonNullable<Awaited<ReturnType<typeof pageState>>>
      >();
      for (const page of [...pages].sort((a, b) => a.id.localeCompare(b.id))) {
        const state = await pageState(tx, page.id);
        if (
          !state ||
          state.version !== page.version ||
          state.lifecycle !== "active"
        )
          throw new Error("clarification:page_changed");
        before.set(page.id, state);
        canonicalSubjects.push(
          (
            await this.identities.assertForPublication(
              tx,
              org,
              page.descriptor.identities,
            )
          ).sort(),
        );
      }
      if (
        kind === "merge" &&
        canonicalSubjects.some((ids) => ids.length) &&
        canonicalSubjects.some(
          (ids) => hash(ids) !== hash(canonicalSubjects[0]),
        )
      )
        throw new Error("needs_attention:unresolved_merge_identity");
      const inputs = [...new Set(pages.flatMap((page) => page.inputs))];
      const current =
        await tx`SELECT d.active_version_id FROM source_documents d JOIN source_versions v ON v.document_id=d.id WHERE d.organization_id=${org} AND v.id IN ${tx(inputs)} ORDER BY d.id FOR SHARE OF d`;
      if (
        inputs.some(
          (version) =>
            !current.some((row) => row.active_version_id === version),
        )
      )
        throw new Error("source_changed");
      const eligible =
        await tx`SELECT e.id,e.eligible FROM wiki_version_eligibility e WHERE e.id IN ${tx(pages.map((page) => page.version))}`;
      if (eligible.some((row) => !row.eligible))
        throw new Error("source_changed");
      await this.sources.assertCurrentForPublication(tx, org, pack.items);
      const editSetId = crypto.randomUUID();
      await tx`INSERT INTO wiki_edit_sets(id,job_id,operation_id,organization_id,kind,reason) VALUES(${editSetId},${job.id},${job.operationId},${org},${kind},${String(proposal.reason)})`;
      for (const edit of edits) {
        await edit.apply(tx);
        await tx`UPDATE wiki_versions SET reason=${String(proposal.reason)} WHERE id=${edit.versionId}`;
        for (const version of inputs)
          await tx`INSERT INTO wiki_version_inputs(version_id,source_version_id) VALUES(${edit.versionId},${version}) ON CONFLICT DO NOTHING`;
      }
      const entries = kind === "merge" ? pages.slice(1) : pages;
      for (const page of entries) {
        await copyWikiVersion(tx, {
          pageId: page.id,
          versionId: page.version,
          operationId: job.operationId,
          reason: String(proposal.reason),
        });
        await tx`UPDATE wiki_pages SET lifecycle=${kind === "merge" ? "redirect" : "split_entry"},retirement=NULL WHERE id=${page.id}`;
        await tx`DELETE FROM wiki_page_routes WHERE page_id=${page.id}`;
        for (const edit of edits)
          await tx`INSERT INTO wiki_page_routes(page_id,successor_id) VALUES(${page.id},${edit.pageId})`;
      }
      for (const pageId of new Set([
        ...pages.map((page) => page.id),
        ...edits.map((edit) => edit.pageId),
      ]))
        await recordPageEdit(tx, editSetId, pageId, before.get(pageId) ?? null);
      await tx`UPDATE wiki_structure_proposals SET status='applied',edit_set_id=${editSetId} WHERE id=${String(proposal.id)}`;
      await tx`INSERT INTO wiki_catalogue_scopes(organization_id,scope,revision) VALUES(${org},${scope},1) ON CONFLICT(organization_id,scope) DO UPDATE SET revision=wiki_catalogue_scopes.revision+1`;
    });
  }
}
