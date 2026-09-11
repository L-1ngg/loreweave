import type { AccessService } from "./access.ts";
import { Operations } from "./operations.ts";
/** Authenticated operation diagnostics and receipt-based recovery; domain readiness stays separate. */
export class MaintenanceService {
  private readonly operations: Operations;
  constructor(
    url: string,
    private readonly access: AccessService,
  ) {
    this.operations = new Operations(url);
  }
  async inspect(token: string, operationId: string) {
    const context = await this.access.authorize(token, "read");
    const [operation] = await this.operations
      .sql`SELECT id,operation_key,created_at FROM knowledge_operations WHERE id=${operationId} AND organization_id=${context.organizationId}`;
    if (!operation) throw new Error("not_found");
    const jobs = await this.operations
      .sql`SELECT j.id,j.kind,j.state,j.reason,j.attempt,j.fence,j.lease_until,w.deadline,
      (SELECT count(*)::int FROM wiki_model_attempts a WHERE a.job_id=j.id) AS requests,
      (SELECT jsonb_build_object('outcome',c.outcome,'committedAt',c.committed_at) FROM knowledge_job_commits c WHERE c.job_id=j.id ORDER BY c.fence DESC LIMIT 1) AS receipt
      FROM knowledge_jobs j LEFT JOIN wiki_work w ON w.job_id=j.id WHERE j.operation_id=${operationId} ORDER BY j.kind,j.id`;
    return {
      id: operationId,
      createdAt: new Date(operation.created_at).toISOString(),
      jobs: jobs.map((job) => ({
        id: String(job.id),
        kind: String(job.kind),
        state: String(job.state),
        reason: job.reason ? String(job.reason) : null,
        attempts: Number(job.attempt),
        fence: Number(job.fence),
        leaseUntil: job.lease_until
          ? new Date(job.lease_until).toISOString()
          : null,
        deadline: job.deadline ? new Date(job.deadline).toISOString() : null,
        requests: Number(job.requests),
        receipt: job.receipt ?? null,
      })),
    };
  }
  async reconcile(token: string, operationId: string) {
    const context = await this.access.authorize(token, "admin");
    const operation = await this.inspect(token, operationId);
    for (const job of operation.jobs)
      if (job.state === "outcome_unknown")
        await this.operations.reconcile(job.id, context.organizationId);
    return this.inspect(token, operationId);
  }
  close() {
    return this.operations.close();
  }
}
