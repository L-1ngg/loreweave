import { Operations, type Job } from "./operations.ts";
import { validateEmbeddings, type EmbeddingAdapter } from "./embeddings.ts";
import { descriptorText } from "./wiki-catalogue.ts";
export class WikiProjection {
  constructor(
    private readonly operations: Operations,
    private readonly embeddings: EmbeddingAdapter,
  ) {}
  async run(job: Job) {
    const [page] = await this.operations
      .sql`SELECT p.id,p.current_version_id,p.organization_id,COALESCE(p.project_id::text,'shared') AS scope,c.descriptor FROM wiki_pages p JOIN wiki_catalogue c ON c.page_id=p.id JOIN knowledge_operations o ON o.id=${job.operationId} AND o.organization_id=p.organization_id WHERE p.id=${String(job.payload.pageId)}`;
    if (!page || page.current_version_id !== job.payload.versionId)
      throw new Error("source_changed");
    const vectors = await this.embeddings.embed(
      [descriptorText(page.descriptor)],
      AbortSignal.timeout(45000),
    );
    validateEmbeddings(vectors, 1, this.embeddings.dimensions);
    await this.operations.commit(job, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki:${page.organization_id}`},0))`;
      const changed =
        await tx`UPDATE wiki_catalogue c SET embedding=${JSON.stringify(vectors[0])}::vector,embedding_profile=${this.embeddings.profile},dimensions=${this.embeddings.dimensions} FROM wiki_pages p WHERE c.page_id=p.id AND p.id=${String(page.id)} AND p.current_version_id=${String(job.payload.versionId)} AND c.version_id=p.current_version_id RETURNING c.page_id`;
      if (!changed.length) throw new Error("source_changed");
      await tx`UPDATE wiki_catalogue_scopes SET revision=revision+1 WHERE organization_id=${String(page.organization_id)} AND scope=${String(page.scope)}`;
    });
  }
  async wake(organizationId?: string) {
    await this.operations
      .sql`UPDATE knowledge_jobs j SET state=CASE WHEN w.deadline<=clock_timestamp() THEN 'failed' ELSE 'queued' END,reason=CASE WHEN w.deadline<=clock_timestamp() THEN 'needs_attention:maintenance_deadline' ELSE NULL END FROM wiki_work w,knowledge_operations o WHERE j.id=w.job_id AND j.operation_id=o.id AND (${organizationId ?? null}::uuid IS NULL OR o.organization_id=${organizationId ?? null}) AND j.state='retry_wait' AND j.kind='wiki.refresh' AND (w.deadline<=clock_timestamp() OR EXISTS(SELECT 1 FROM jsonb_each_text(COALESCE(w.state->'waitRevisions','{}')) expected LEFT JOIN wiki_catalogue_scopes c ON c.organization_id=o.organization_id AND c.scope=expected.key WHERE COALESCE(c.revision,0)<>expected.value::bigint))`;
  }
}
