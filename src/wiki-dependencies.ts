import {
  Operations,
  jsonValue,
  type Job,
  type Transaction,
} from "./operations.ts";
import type { TopicDescriptor } from "./wiki-types.ts";
export async function queuePageRefresh(
  tx: Transaction,
  job: Job,
  pageId: string,
  contribution?: { versionId: string; topic: TopicDescriptor },
) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`wiki-work:${job.operationId}:${pageId}`},0))`;
  const [existing] =
    await tx`SELECT id,payload,state FROM knowledge_jobs WHERE operation_id=${job.operationId} AND kind='wiki.revalidate' AND job_key=${pageId} FOR UPDATE`;
  if (existing) {
    if (contribution) {
      const contributions = [
        ...(existing.payload.contributions ?? []),
        contribution,
      ];
      await tx`UPDATE knowledge_jobs SET payload=payload||${tx.json(jsonValue({ contributions }))}::jsonb WHERE id=${String(existing.id)}`;
    }
    return;
  }
  await tx`INSERT INTO knowledge_jobs(id,operation_id,kind,payload,job_key) VALUES(${crypto.randomUUID()},${job.operationId},'wiki.revalidate',${tx.json(jsonValue({ ...job.payload, pageId, contributions: contribution ? [contribution] : [] }))},${pageId}) ON CONFLICT(operation_id,kind,job_key) DO NOTHING`;
}
/** Historical dependency walks deliberately do not use discovery's project/Top-K filters. */
export class WikiDependencies {
  constructor(private readonly operations: Operations) {}
  async readyJobs(organizationId?: string) {
    const rows = await this.operations
      .sql`SELECT j.id FROM knowledge_jobs j JOIN knowledge_operations o ON o.id=j.operation_id WHERE (${organizationId ?? null}::uuid IS NULL OR o.organization_id=${organizationId ?? null}) AND j.kind IN ('wiki.refresh','wiki.project','wiki.dependencies','wiki.revalidate','wiki.identity') AND (j.state='queued' OR (j.state='running' AND j.lease_until<clock_timestamp())) AND (j.kind<>'wiki.revalidate' OR NOT EXISTS(SELECT 1 FROM knowledge_jobs upstream WHERE upstream.operation_id=j.operation_id AND (upstream.kind IN ('wiki.refresh','wiki.dependencies','wiki.identity') OR (upstream.kind='identity.revalidate' AND EXISTS(SELECT 1 FROM wiki_pages page JOIN wiki_versions version ON version.id=page.current_version_id WHERE page.id::text=j.job_key AND version.identity_dependencies<>'[]'::jsonb))) AND upstream.state IN ('queued','running','retry_wait','outcome_unknown'))) ORDER BY j.id LIMIT 20`;
    return rows.map((row) => String(row.id));
  }
  async supersede(organizationId?: string) {
    await this.operations
      .sql`UPDATE knowledge_jobs j SET state='failed',reason='needs_attention:discovery_incomplete' FROM knowledge_operations o WHERE o.id=j.operation_id AND (${organizationId ?? null}::uuid IS NULL OR o.organization_id=${organizationId ?? null}) AND j.state='queued' AND j.kind='wiki.revalidate' AND EXISTS(SELECT 1 FROM knowledge_jobs discovery WHERE discovery.operation_id=j.operation_id AND discovery.kind='wiki.refresh' AND discovery.state='failed' AND EXISTS(SELECT 1 FROM wiki_work work,jsonb_each(work.state) entry WHERE work.job_id=discovery.id AND entry.key LIKE 'topic:%' AND entry.value->'decision'->>'pageId'=j.job_key))`;
    await this.operations
      .sql`UPDATE knowledge_jobs j SET state='superseded',reason='source_changed' FROM knowledge_operations o WHERE o.id=j.operation_id AND (${organizationId ?? null}::uuid IS NULL OR o.organization_id=${organizationId ?? null}) AND j.state IN ('queued','retry_wait') AND j.kind IN ('wiki.refresh','wiki.dependencies','wiki.revalidate','wiki.identity') AND EXISTS(SELECT 1 FROM source_versions v JOIN source_documents d ON d.id=v.document_id WHERE v.id::text=COALESCE(j.payload->>'sourceVersionId',j.payload->>'versionId') AND d.active_version_id<>v.id)`;
  }
  async run(job: Job) {
    const [owner] = await this.operations
      .sql`SELECT organization_id FROM knowledge_operations WHERE id=${job.operationId}`;
    const organizationId = String(owner!.organization_id);
    const [walk] = await this.operations
      .sql`SELECT * FROM wiki_dependency_walks WHERE job_id=${job.id}`;
    const cursor = String(walk?.cursor ?? "");
    const mentionIds = (job.payload.mentionIds ??
      (job.payload.mentionId ? [job.payload.mentionId] : [])) as string[];
    const rows =
      job.kind === "wiki.identity"
        ? await this.operations
            .sql`SELECT p.id FROM wiki_pages p WHERE p.organization_id=${organizationId} AND p.id::text>${cursor} AND EXISTS(SELECT 1 FROM wiki_versions v,jsonb_array_elements(v.identity_dependencies) ref WHERE v.page_id=p.id AND ${this.operations.sql.json(mentionIds)}::jsonb ? (ref->>'mentionId')) ORDER BY p.id LIMIT 21`
        : await this.operations
            .sql`SELECT p.id FROM wiki_pages p WHERE p.organization_id=${organizationId} AND p.id::text>${cursor} AND EXISTS(SELECT 1 FROM wiki_versions v JOIN wiki_version_inputs refs ON refs.version_id=v.id JOIN source_versions source ON source.id=refs.source_version_id WHERE v.page_id=p.id AND source.document_id=${String(job.payload.documentId)} AND source.id<>${String(job.payload.versionId)}) ORDER BY p.id LIMIT 21`;
    const batch = rows.slice(0, 20);
    await this.operations.commit(job, async (tx) => {
      if (job.kind === "wiki.dependencies") {
        const [current] =
          await tx`SELECT active_version_id FROM source_documents WHERE id=${String(job.payload.documentId)} AND organization_id=${organizationId} FOR SHARE`;
        if (current?.active_version_id !== job.payload.versionId)
          return "superseded";
      }
      for (const page of batch)
        await queuePageRefresh(tx, job, String(page.id));
      await tx`INSERT INTO wiki_dependency_walks(job_id,cursor,complete,page_ids,batch_sizes) VALUES(${job.id},${batch.length ? String(batch.at(-1)!.id) : cursor},${rows.length <= 20},${tx.json(batch.map((page) => String(page.id)))},${tx.json([batch.length])}) ON CONFLICT(job_id) DO UPDATE SET cursor=excluded.cursor,complete=excluded.complete,page_ids=wiki_dependency_walks.page_ids||excluded.page_ids,batch_sizes=wiki_dependency_walks.batch_sizes||excluded.batch_sizes`;
      return rows.length > 20 ? "queued" : "succeeded";
    });
  }
}
