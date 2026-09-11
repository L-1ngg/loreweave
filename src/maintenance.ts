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
  async activity(token: string) {
    const context = await this.access.authorize(token, "read");
    const [operations] = await this.operations
      .sql`SELECT count(*)::int AS count FROM knowledge_operations WHERE organization_id=${context.organizationId}`;
    const rows = await this.operations
      .sql`SELECT j.kind,j.state,count(*)::int AS count FROM knowledge_jobs j JOIN knowledge_operations o ON o.id=j.operation_id WHERE o.organization_id=${context.organizationId} AND j.state NOT IN ('succeeded','superseded') GROUP BY j.kind,j.state ORDER BY j.kind,j.state`;
    return {
      sampledAt: new Date().toISOString(),
      acceptedOperations: Number(operations!.count),
      pending: rows
        .filter((row) => row.state !== "failed")
        .reduce((sum, row) => sum + Number(row.count), 0),
      failed: rows
        .filter((row) => row.state === "failed")
        .reduce((sum, row) => sum + Number(row.count), 0),
      jobs: rows.map((row) => ({
        kind: String(row.kind),
        state: String(row.state),
        count: Number(row.count),
      })),
    };
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
    const requests = await this.operations
      .sql`SELECT a.* FROM wiki_model_attempts a JOIN knowledge_jobs j ON j.id=a.job_id WHERE j.operation_id=${operationId} ORDER BY a.started_at,a.job_id,a.unit_key,a.phase,a.attempt`;
    return {
      modelRequests: requests.map((row) => ({
        jobId: String(row.job_id),
        unit: String(row.unit_key),
        phase: String(row.phase),
        attempt: Number(row.attempt),
        state: String(row.state),
        model: String(row.model_profile),
        prompt: String(row.prompt_profile),
        inputHash: String(row.input_hash),
        startedAt: new Date(row.started_at).toISOString(),
        dispatchedAt: row.dispatched_at
          ? new Date(row.dispatched_at).toISOString()
          : null,
        completedAt: row.completed_at
          ? new Date(row.completed_at).toISOString()
          : null,
        response: row.response,
        error: row.error,
      })),
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
