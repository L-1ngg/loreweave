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
  ): Promise<Job | undefined> {
    const [row] = await this
      .sql`UPDATE knowledge_jobs SET state='running', attempt=attempt+1, fence=fence+1,
      lease_until=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      WHERE id=(SELECT id FROM knowledge_jobs WHERE kind IN ${this.sql(kinds)} AND (${organizationId ?? null}::uuid IS NULL OR operation_id IN (SELECT id FROM knowledge_operations WHERE organization_id=${organizationId ?? null})) AND
      ((state='queued' OR (state='retry_wait' AND kind NOT LIKE 'wiki.%')) OR (state='running' AND lease_until<clock_timestamp()))
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
    await this.sql.begin(async (tx) => {
      await assertLease(tx, job);
      const outcome = (await effect(tx)) ?? state;
      const [completed] =
        await tx`UPDATE knowledge_jobs SET state=${outcome},lease_until=NULL WHERE id=${job.id} AND fence=${job.fence} AND state='running' AND lease_until>clock_timestamp() RETURNING id`;
      if (!completed) throw new Error("stale_worker");
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
    await this.sql.end();
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
