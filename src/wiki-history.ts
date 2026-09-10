import { AccessService } from "./access.ts";
import { hash, record } from "./answer-validation.ts";
import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import {
  copyWikiVersion,
  pageState,
  recordPageEdit,
  type PageState,
} from "./wiki-edit-history.ts";

export interface RestorePageInput {
  key: string;
  pageId: string;
  versionId: string;
  expectedVersion: string;
  reason: string;
}
export interface RestoreEditSetInput {
  key: string;
  editSetId: string;
  reason: string;
}

/** History is immutable. Recovery copies reviewed content and preserves current source truth. */
export class WikiHistory {
  constructor(
    private readonly operations: Operations,
    private readonly access: AccessService,
  ) {}

  async list(token: string, pageId: string) {
    const context = await this.access.authorize(token, "read");
    const rows = await this.operations
      .sql`SELECT v.id,v.title,v.created_at,v.reason,v.restored_from,v.operation_id,p.current_version_id,(SELECT edit_set_id FROM wiki_edit_pages e WHERE e.page_id=p.id AND e.after_state->>'version'=v.id::text LIMIT 1) AS edit_set_id FROM wiki_versions v JOIN wiki_pages p ON p.id=v.page_id WHERE p.id=${pageId} AND p.organization_id=${context.organizationId} ORDER BY v.created_at DESC,v.id DESC`;
    if (!rows.length) throw new Error("not_found");
    return {
      items: rows.map((row) => ({
        version: String(row.id),
        title: String(row.title),
        createdAt: new Date(row.created_at).toISOString(),
        reason: row.reason as string | null,
        restoredFrom: row.restored_from as string | null,
        operationId: String(row.operation_id),
        current: row.id === row.current_version_id,
        editSetId: row.edit_set_id as string | null,
      })),
    };
  }

  async restore(token: string, input: RestorePageInput) {
    const context = await this.access.authorize(token, "restore");
    if (
      !input.reason.trim() ||
      new TextEncoder().encode(input.reason).length > 1000
    )
      throw new Error("invalid_input");
    const inputHash = hash({ kind: "wiki.restore", ...input });
    const prior = await this.operations.lookup(context, input.key, inputHash);
    if (prior) return { status: "accepted" as const, operationId: prior };
    const [page] = await this.operations
      .sql`SELECT p.current_version_id,p.lifecycle FROM wiki_pages p JOIN wiki_versions v ON v.page_id=p.id AND v.id=${input.versionId} WHERE p.id=${input.pageId} AND p.organization_id=${context.organizationId}`;
    if (!page) throw new Error("not_found");
    if (page.current_version_id !== input.expectedVersion)
      return {
        status: "clarification" as const,
        reason: "page_changed",
        pageId: input.pageId,
        currentVersion: String(page.current_version_id),
      };
    if (["redirect", "split_entry"].includes(page.lifecycle))
      return {
        status: "clarification" as const,
        reason: "restore_edit_set",
        pageId: input.pageId,
        currentVersion: String(page.current_version_id),
      };
    const operationId = await this.operations.accept(
      context,
      input.key,
      inputHash,
      async (tx, id) => {
        await this.operations.enqueue(tx, id, "wiki.restore", { ...input });
      },
    );
    return { status: "accepted" as const, operationId };
  }

  async restoreSet(token: string, input: RestoreEditSetInput) {
    const context = await this.access.authorize(token, "restore");
    if (
      !input.reason.trim() ||
      new TextEncoder().encode(input.reason).length > 1000
    )
      throw new Error("invalid_input");
    const inputHash = hash({ kind: "wiki.restore_set", ...input });
    const prior = await this.operations.lookup(context, input.key, inputHash);
    if (prior) return { status: "accepted" as const, operationId: prior };
    const [editSet] = await this.operations
      .sql`SELECT id FROM wiki_edit_sets WHERE id=${input.editSetId} AND organization_id=${context.organizationId}`;
    if (!editSet) throw new Error("not_found");
    const changes = await this.operations
      .sql`SELECT page_id,after_state FROM wiki_edit_pages WHERE edit_set_id=${input.editSetId} ORDER BY page_id`;
    const changed = await this.operations.sql.begin(async (tx) => {
      const result: Array<{ pageId: string; version: string }> = [];
      for (const change of changes) {
        const current = await pageState(tx, String(change.page_id));
        if (hash(current) !== hash(change.after_state))
          result.push({
            pageId: String(change.page_id),
            version: current?.version ?? "",
          });
      }
      return result;
    });
    if (changed.length)
      return {
        status: "clarification" as const,
        reason: "related_pages_changed",
        pages: changed,
      };
    const operationId = await this.operations.accept(
      context,
      input.key,
      inputHash,
      async (tx, id) => {
        await this.operations.enqueue(tx, id, "wiki.restore", { ...input });
      },
    );
    return { status: "accepted" as const, operationId };
  }

  private async refreshRestored(
    tx: Transaction,
    job: Job,
    pageId: string,
    versionId: string,
    lifecycle: string,
  ) {
    // Lock the current dependency pointers while recording the new version's readiness.
    await tx`SELECT d.id FROM source_documents d JOIN source_versions s ON s.document_id=d.id JOIN wiki_version_inputs refs ON refs.source_version_id=s.id WHERE refs.version_id=${versionId} ORDER BY d.id FOR SHARE OF d`;
    await tx`SELECT m.id FROM identity_mentions m JOIN wiki_versions v ON v.id=${versionId} WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.identity_dependencies) ref WHERE ref->>'mentionId'=m.id::text) ORDER BY m.id FOR SHARE OF m`;
    const [eligibility] =
      await tx`SELECT eligible FROM wiki_version_eligibility WHERE id=${versionId}`;
    if (lifecycle === "redirect" || lifecycle === "split_entry") return;
    await this.operations.enqueue(
      tx,
      job.operationId,
      eligibility?.eligible && lifecycle === "active"
        ? "wiki.project"
        : "wiki.revalidate",
      {
        pageId,
        ...(eligibility?.eligible && lifecycle === "active"
          ? { versionId }
          : {}),
      },
      pageId,
    );
  }

  private async restoreSetInTransaction(
    tx: Transaction,
    job: Job,
    org: string,
    actorId: string,
  ) {
    const [original] =
      await tx`SELECT * FROM wiki_edit_sets WHERE id=${String(job.payload.editSetId)} AND organization_id=${org}`;
    if (!original) throw new Error("not_found");
    const changes =
      await tx`SELECT * FROM wiki_edit_pages WHERE edit_set_id=${String(original.id)} ORDER BY page_id`;
    const before = new Map<string, PageState>();
    for (const change of changes) {
      const state = await pageState(tx, String(change.page_id));
      if (!state || hash(state) !== hash(change.after_state))
        throw new Error("clarification:related_pages_changed");
      before.set(String(change.page_id), state);
    }
    const editSetId = crypto.randomUUID(),
      reason = String(job.payload.reason);
    await tx`INSERT INTO wiki_edit_sets(id,job_id,operation_id,organization_id,kind,reason,restored_from) VALUES(${editSetId},${job.id},${job.operationId},${org},'restore',${reason},${String(original.id)})`;
    for (const change of changes) {
      const pageId = String(change.page_id),
        old = change.before_state as PageState | null,
        current = before.get(pageId)!;
      const versionId = await copyWikiVersion(tx, {
        pageId,
        versionId: old?.version ?? current.version,
        operationId: job.operationId,
        reason,
        restored: true,
      });
      const lifecycle = old?.lifecycle ?? "redirect";
      await tx`UPDATE wiki_pages SET lifecycle=${lifecycle},retirement=${old?.retirement ? tx.json(old.retirement) : null} WHERE id=${pageId}`;
      await tx`DELETE FROM wiki_page_routes WHERE page_id=${pageId}`;
      const successors =
        old?.successors ??
        changes
          .filter((other) => other.before_state !== null)
          .map((other) => String(other.page_id));
      if (lifecycle === "redirect" || lifecycle === "split_entry")
        for (const successor of successors)
          await tx`INSERT INTO wiki_page_routes(page_id,successor_id) VALUES(${pageId},${successor})`;
      await this.refreshRestored(tx, job, pageId, versionId, lifecycle);
      await tx`INSERT INTO wiki_guidance(id,operation_id,organization_id,actor_id,project_id,page_id,body) SELECT ${crypto.randomUUID()},${job.operationId},${org},${actorId},project_id,id,${reason} FROM wiki_pages WHERE id=${pageId}`;
    }
    for (const change of changes)
      await recordPageEdit(
        tx,
        editSetId,
        String(change.page_id),
        before.get(String(change.page_id))!,
      );
    await tx`UPDATE wiki_structure_proposals SET status='reversed' WHERE edit_set_id=${String(original.id)}`;
    const scopes =
      await tx`SELECT DISTINCT COALESCE(p.project_id::text,'shared') AS scope FROM wiki_pages p JOIN wiki_edit_pages e ON e.page_id=p.id WHERE e.edit_set_id=${editSetId}`;
    for (const scope of scopes)
      await tx`INSERT INTO wiki_catalogue_scopes(organization_id,scope,revision) VALUES(${org},${String(scope.scope)},1) ON CONFLICT(organization_id,scope) DO UPDATE SET revision=wiki_catalogue_scopes.revision+1`;
  }

  async run(job: Job) {
    const input = job.payload;
    if (!record(input)) throw new Error("invalid_input");
    await this.operations.commit(job, async (tx) => {
      const [owner] =
        await tx`SELECT organization_id,actor_id FROM knowledge_operations WHERE id=${job.operationId}`;
      const org = String(owner!.organization_id);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${org}`},0))`;
      if (input.editSetId) {
        await this.restoreSetInTransaction(
          tx,
          job,
          org,
          String(owner!.actor_id),
        );
        return;
      }
      const [page] =
        await tx`SELECT * FROM wiki_pages WHERE id=${String(input.pageId)} AND organization_id=${org} FOR UPDATE`;
      if (!page) throw new Error("not_found");
      if (
        page.current_version_id !== input.expectedVersion ||
        ["redirect", "split_entry"].includes(page.lifecycle)
      ) {
        await tx`UPDATE knowledge_jobs SET reason='clarification:page_changed' WHERE id=${job.id}`;
        return "failed";
      }
      const versionId = await copyWikiVersion(tx, {
        pageId: String(page.id),
        versionId: String(input.versionId),
        operationId: job.operationId,
        reason: String(input.reason),
        restored: true,
      });
      await tx`INSERT INTO wiki_catalogue_scopes(organization_id,scope,revision) VALUES(${org},${String(page.project_id ?? "shared")},1) ON CONFLICT(organization_id,scope) DO UPDATE SET revision=wiki_catalogue_scopes.revision+1`;
      await tx`INSERT INTO wiki_guidance(id,operation_id,organization_id,actor_id,project_id,page_id,body) VALUES(${crypto.randomUUID()},${job.operationId},${org},${String(owner!.actor_id)},${page.project_id ?? null},${String(page.id)},${String(input.reason)})`;
      await this.refreshRestored(
        tx,
        job,
        String(page.id),
        versionId,
        String(page.lifecycle),
      );
    });
  }
}
