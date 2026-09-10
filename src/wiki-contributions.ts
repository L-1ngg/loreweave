import { AccessService } from "./access.ts";
import { Operations, jsonValue } from "./operations.ts";
import { SourceService } from "./sources.ts";
import { hash } from "./answer-validation.ts";
import { normalizeTitle } from "./wiki-catalogue.ts";
export interface ContributionInput {
  key: string;
  kind: "fact" | "guidance";
  text: string;
  target?: string;
  projectId?: string;
}
/** The actor/scope comes from authentication. User facts remain attributed sources. */
export class WikiContributions {
  constructor(
    private readonly operations: Operations,
    private readonly access: AccessService,
    private readonly sources: SourceService,
  ) {}
  async submit(token: string, input: ContributionInput) {
    const context = await this.access.authorize(
      token,
      "correct",
      input.projectId,
    );
    if (
      !["fact", "guidance"].includes(input.kind) ||
      !input.text.trim() ||
      new TextEncoder().encode(input.text).length > 4000 ||
      (input.target && input.target.length > 200)
    )
      throw new Error("invalid_input");
    const inputHash = hash({
      kind: input.kind,
      text: input.text,
      target: input.target ?? null,
      projectId: input.projectId ?? null,
    });
    const prior = await this.operations.lookup(context, input.key, inputHash);
    if (prior) return { status: "accepted" as const, operationId: prior };
    let pageId: string | undefined;
    if (input.target) {
      const title = normalizeTitle(input.target);
      const matches = await this.operations
        .sql`SELECT p.id,v.title FROM wiki_pages p JOIN wiki_versions v ON v.id=p.current_version_id JOIN wiki_catalogue c ON c.page_id=p.id WHERE p.organization_id=${context.organizationId} AND p.project_id IS NOT DISTINCT FROM ${input.projectId ?? null}::uuid AND (c.normalized_title=${title} OR c.aliases ? ${title}) ORDER BY p.id LIMIT 3`;
      if (matches.length !== 1)
        return {
          status: "clarification" as const,
          reason: matches.length ? "ambiguous_target" : "target_not_found",
          candidates: matches.map((row) => ({
            title: String(row.title),
            pageId: String(row.id),
          })),
        };
      pageId = String(matches[0]!.id);
    }
    if (input.kind === "fact") {
      // SourceService owns the atomic note, original bytes, operation and preparation job.
      const operationId = await this.operations.accept(
        context,
        input.key,
        inputHash,
        (tx, id) =>
          this.sources.stageNote(tx, context, id, {
            text: input.text,
            ...(pageId ? { pageId } : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
          }),
      );
      return { status: "accepted" as const, operationId };
    }
    const operationId = await this.operations.accept(
      context,
      input.key,
      inputHash,
      async (tx, id) => {
        await tx`INSERT INTO wiki_guidance(id,operation_id,organization_id,actor_id,project_id,page_id,body) VALUES(${crypto.randomUUID()},${id},${context.organizationId},${context.actorId},${input.projectId ?? null},${pageId ?? null},${input.text})`;
        await this.operations.enqueue(tx, id, "wiki.guidance", {});
        await tx`UPDATE knowledge_jobs SET state='succeeded' WHERE operation_id=${id} AND kind='wiki.guidance'`;
      },
    );
    return { status: "accepted" as const, operationId };
  }
  async guidance(token: string, projectId?: string) {
    const context = await this.access.authorize(token, "read", projectId);
    const rows = await this.operations
      .sql`SELECT * FROM wiki_guidance WHERE organization_id=${context.organizationId} AND (project_id IS NULL OR project_id=${projectId ?? null}) ORDER BY created_at,id`;
    return rows.map((row) => ({
      id: String(row.id),
      operationId: String(row.operation_id),
      actorId: String(row.actor_id),
      projectId: row.project_id as string | null,
      pageId: row.page_id as string | null,
      text: String(row.body),
      priorOperationId: row.prior_operation_id as string | null,
    }));
  }
  async repair(
    token: string,
    input: { key: string; operationId: string; guidance: string },
  ) {
    const context = await this.access.authorize(token, "correct");
    if (
      !input.guidance.trim() ||
      new TextEncoder().encode(input.guidance).length > 1000
    )
      throw new Error("invalid_input");
    return this.operations.accept(
      context,
      input.key,
      hash(input),
      async (tx, id) => {
        const [prior] =
          await tx`SELECT id FROM knowledge_operations WHERE id=${input.operationId} AND organization_id=${context.organizationId}`;
        if (!prior) throw new Error("not_found");
        const jobs =
          await tx`SELECT * FROM knowledge_jobs WHERE operation_id=${input.operationId} AND kind IN ('wiki.refresh','wiki.dependencies','wiki.identity','wiki.revalidate') AND state IN ('failed','retry_wait') ORDER BY id`;
        if (!jobs.length) throw new Error("invalid_input");
        await tx`INSERT INTO wiki_guidance(id,operation_id,organization_id,actor_id,body,prior_operation_id) VALUES(${crypto.randomUUID()},${id},${context.organizationId},${context.actorId},${input.guidance},${input.operationId})`;
        for (const job of jobs)
          await this.operations.enqueue(
            tx,
            id,
            String(job.kind),
            jsonValue({ ...job.payload, repairOf: String(job.id) }) as Record<
              string,
              unknown
            >,
            String(job.job_key),
          );
      },
    );
  }
}
