import postgres from "postgres";
import type { TrustedContext } from "./access.ts";
export type Transaction = postgres.TransactionSql;
export interface Job {
  id: string;
  operationId: string;
  kind: string;
  payload: Record<string, unknown>;
  fence: number;
  attempt: number;
}
export type JobState =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "superseded";
/** Shared transaction boundary for operation receipts and domain effects. */
export class Operations {
  readonly sql;
  constructor(url: string) {
    this.sql = postgres(url, { max: 5, onnotice: () => {} });
  }
  async lookup(
    context: TrustedContext,
    key: string,
    hash: string,
  ): Promise<string | undefined> {
    if (!key || key.length > 200) throw new Error("invalid_input");
    const [existing] = await this
      .sql`SELECT id,payload_hash FROM knowledge_operations WHERE organization_id=${context.organizationId} AND actor_id=${context.actorId} AND operation_key=${key}`;
    if (!existing) return undefined;
    if (existing.payload_hash !== hash) throw new Error("version_conflict");
    return String(existing.id);
  }
  async accept<T>(
    context: TrustedContext,
    key: string,
    hash: string,
    create: (tx: Transaction, id: string) => Promise<T>,
  ): Promise<string> {
    if (!key || key.length > 200) throw new Error("invalid_input");
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${context.actorId}:${key}`},0))`;
      const [existing] =
        await tx`SELECT id,payload_hash FROM knowledge_operations WHERE organization_id=${context.organizationId} AND actor_id=${context.actorId} AND operation_key=${key}`;
      if (existing) {
        if (existing.payload_hash !== hash) throw new Error("version_conflict");
        return String(existing.id);
      }
      const id = crypto.randomUUID();
      await tx`INSERT INTO knowledge_operations(id,organization_id,actor_id,operation_key,payload_hash) VALUES(${id},${context.organizationId},${context.actorId},${key},${hash})`;
      await create(tx, id);
      return id;
    });
  }
  async enqueue(
    tx: Transaction,
    operationId: string,
    kind: string,
    payload: Record<string, unknown>,
    jobKey = "",
  ): Promise<void> {
    await tx`INSERT INTO knowledge_jobs(id,operation_id,kind,payload,job_key) VALUES(${crypto.randomUUID()},${operationId},${kind},${tx.json(payload as postgres.JSONValue)},${jobKey})`;
  }
  async claim(
    kinds: string[],
    leaseMs = 60000,
    organizationId?: string,
    eligibleIds?: string[],
  ): Promise<Job | undefined> {
    if (eligibleIds && !eligibleIds.length) return undefined;
    const [row] = await this
      .sql`UPDATE knowledge_jobs SET state='running', attempt=attempt+1, fence=fence+1,
      lease_until=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      WHERE id=(SELECT id FROM knowledge_jobs WHERE kind IN ${this.sql(kinds)} AND (${organizationId ?? null}::uuid IS NULL OR operation_id IN (SELECT id FROM knowledge_operations WHERE organization_id=${organizationId ?? null})) AND
      ((state='queued' OR (state='retry_wait' AND kind NOT LIKE 'wiki.%')) OR (state='running' AND lease_until<clock_timestamp()))
      AND (${eligibleIds === undefined} OR id::text IN (SELECT value FROM jsonb_array_elements_text(${this.sql.json(eligibleIds ?? [])}::jsonb)))
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    return row
      ? {
          id: String(row.id),
          operationId: String(row.operation_id),
          kind: String(row.kind),
          payload: row.payload,
          fence: Number(row.fence),
          attempt: Number(row.attempt),
        }
      : undefined;
  }
  async commit(
    job: Job,
    effect: (tx: Transaction) => Promise<void | JobState>,
    state: JobState = "succeeded",
  ): Promise<void> {
    if (await this.committed(job)) return;
    try {
      await this.sql.begin(async (tx) => {
        await assertLease(tx, job);
        await tx`SELECT set_config('loreweave.operation_id',${job.operationId},true)`;
        const outcome = (await effect(tx)) ?? state;
        const [completed] =
          await tx`UPDATE knowledge_jobs SET state=${outcome},lease_until=NULL WHERE id=${job.id} AND fence=${job.fence} AND state='running' AND lease_until>clock_timestamp() RETURNING id`;
        if (!completed) throw new Error("stale_worker");
        await tx`INSERT INTO knowledge_job_commits(job_id,fence,outcome) VALUES(${job.id},${job.fence},${outcome})`;
      });
    } catch (error) {
      // A lost COMMIT acknowledgement is resolved against the transaction's receipt.
      // If the database is still unavailable the caller must keep the outcome unknown.
      if (await this.committed(job).catch(() => undefined)) return;
      throw error;
    }
  }
  async committed(
    job: Pick<Job, "id" | "fence">,
  ): Promise<{ outcome: JobState; committedAt: string } | undefined> {
    const [row] = await this
      .sql`SELECT outcome,committed_at FROM knowledge_job_commits WHERE job_id=${job.id} AND fence=${job.fence}`;
    return row
      ? {
          outcome: row.outcome as JobState,
          committedAt: new Date(row.committed_at).toISOString(),
        }
      : undefined;
  }
  /** Unknown outcomes are inspected under the job lock before any dispatch becomes eligible. */
  async reconcile(jobId: string, organizationId: string) {
    return this.sql.begin(async (tx) => {
      const [job] =
        await tx`SELECT j.* FROM knowledge_jobs j JOIN knowledge_operations o ON o.id=j.operation_id WHERE j.id=${jobId} AND o.organization_id=${organizationId} FOR UPDATE OF j`;
      if (!job) throw new Error("not_found");
      if (
        job.state === "outcome_unknown" &&
        job.reason === "needs_attention:legacy_unknown"
      )
        throw new Error("unavailable");
      if (job.state !== "outcome_unknown")
        return { state: String(job.state), recovered: false };
      const [receipt] =
        await tx`SELECT outcome FROM knowledge_job_commits WHERE job_id=${jobId} AND fence=${Number(job.fence)}`;
      const state = receipt ? String(receipt.outcome) : "queued";
      await tx`UPDATE knowledge_jobs SET state=${state},reason=NULL,lease_until=NULL WHERE id=${jobId}`;
      return { state, recovered: Boolean(receipt) };
    });
  }
  async checkpoint<T>(
    job: Job,
    effect: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin(async (tx) => {
      await assertLease(tx, job);
      const result = await effect(tx);
      await assertLease(tx, job);
      return result;
    }) as Promise<T>;
  }
  async close() {
    // A lost transaction connection can retain a reservation in the driver.
    // Shutdown still drains normally, with a finite fallback for that dead socket.
    await this.sql.end({ timeout: 5 });
  }
}

async function assertLease(tx: Transaction, job: Job) {
  const [row] =
    await tx`SELECT id FROM knowledge_jobs WHERE id=${job.id} AND fence=${job.fence} AND state='running' AND lease_until>clock_timestamp() FOR UPDATE`;
  if (!row) throw new Error("stale_worker");
}

/** Normalize domain records to the JSON values accepted by the PostgreSQL adapter. */
export function jsonValue(value: unknown): postgres.JSONValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("invalid_input");
  return JSON.parse(encoded);
}
