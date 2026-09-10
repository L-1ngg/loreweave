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
  ): Promise<void> {
    await tx`INSERT INTO knowledge_jobs(id,operation_id,kind,payload) VALUES(${crypto.randomUUID()},${operationId},${kind},${tx.json(payload as postgres.JSONValue)})`;
  }
  async claim(kinds: string[], leaseMs = 60000): Promise<Job | undefined> {
    const [row] = await this
      .sql`UPDATE knowledge_jobs SET state='running', attempt=attempt+1, fence=fence+1,
      lease_until=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      WHERE id=(SELECT id FROM knowledge_jobs WHERE kind IN ${this.sql(kinds)} AND
      (state IN ('queued','retry_wait') OR (state='running' AND lease_until<clock_timestamp()))
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
    effect: (tx: Transaction) => Promise<void>,
    state: JobState = "succeeded",
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [row] =
        await tx`SELECT id FROM knowledge_jobs WHERE id=${job.id} AND fence=${job.fence} AND state='running' AND lease_until>clock_timestamp() FOR UPDATE`;
      if (!row) throw new Error("stale_worker");
      await effect(tx);
      await tx`UPDATE knowledge_jobs SET state=${state},lease_until=NULL WHERE id=${job.id}`;
    });
  }
  async close() {
    await this.sql.end();
  }
}
