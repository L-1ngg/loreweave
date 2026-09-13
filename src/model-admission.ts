import { modelTransport } from "./model-transport.ts";
import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { hash } from "./answer-validation.ts";

export interface ModelWork {
  operationId: string;
  parentOperationId?: string;
  priority: "interactive" | "background";
  deadline: number;
  requestTimeoutMs?: number;
  onDispatch?: (requestId?: string) => Promise<void>;
}
const work = new AsyncLocalStorage<ModelWork>();
export function currentModelWork() {
  return work.getStore();
}
export function withModelWork<T>(context: ModelWork, run: () => T): T {
  return work.run(context, run);
}

/** The database owns HTTP capacity; remote uncertainty remains a separate audit. */
export class ModelAdmission {
  private readonly sql;
  private readonly owner = crypto.randomUUID();
  private readonly authority = new AbortController();
  private readonly ingress = new AbortController();
  private readonly transports = new Map<
    string,
    { operationId: string; parentOperationId?: string; done: Promise<void> }
  >();
  private readonly pending = new Map<
    Promise<Response>,
    ModelWork | undefined
  >();
  private closing?: Promise<void>;
  private settlementFailure?: unknown;
  private starting?: Promise<void>;
  private renewal?: Promise<void>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(
    url: string,
    private readonly leaseMs = 30000,
    private readonly settlementMs = 300000,
  ) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 100)
      throw new Error("invalid_model_owner_lease");
    if (!Number.isSafeInteger(settlementMs) || settlementMs < 100)
      throw new Error("invalid_model_settlement_timeout");
    this.sql = postgres(url, { max: 3, onnotice: () => {} });
  }
  private async ensureOwner() {
    this.authority.signal.throwIfAborted();
    this.starting ??= (async () => {
      const started = performance.now();
      await this
        .sql`INSERT INTO model_owners(id,lease_until) VALUES(${this.owner},clock_timestamp()+${this.leaseMs}*interval '1 millisecond')`;
      this.guard(started);
      this.schedule();
    })();
    await this.starting;
    this.authority.signal.throwIfAborted();
  }
  private guard(started: number) {
    clearTimeout(this.expiry);
    const remaining = this.leaseMs - (performance.now() - started);
    if (remaining <= 0) this.authority.abort(new Error("model_authority_lost"));
    else {
      this.expiry = setTimeout(
        () => this.authority.abort(new Error("model_authority_lost")),
        remaining,
      );
      this.expiry.unref();
    }
  }
  private schedule() {
    if (this.authority.signal.aborted) return;
    this.heartbeat = setTimeout(() => {
      this.renewal = (async () => {
        const started = performance.now();
        try {
          const row = await this.sql.begin(async (tx) => {
            await tx`SELECT id FROM model_owners WHERE id=${this.owner} FOR UPDATE`;
            const [renewed] =
              await tx`UPDATE model_owners SET lease_until=clock_timestamp()+${this.leaseMs}*interval '1 millisecond' WHERE id=${this.owner} AND lease_until>clock_timestamp() RETURNING id`;
            return renewed;
          });
          if (!row) throw new Error("model_authority_lost");
          this.guard(started);
          this.schedule();
        } catch {
          this.authority.abort(new Error("model_authority_lost"));
        }
      })();
    }, this.leaseMs / 3);
    this.heartbeat.unref();
  }
  private async admittedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ) {
    this.ingress.signal.throwIfAborted();
    await this.ensureOwner();
    const context = work.getStore();
    if (!context) throw new Error("missing_model_work");
    const id = crypto.randomUUID();
    const signal = AbortSignal.any([
      this.authority.signal,
      this.ingress.signal,
      ...(init?.signal
        ? [init.signal]
        : input instanceof Request
          ? [input.signal]
          : []),
      AbortSignal.timeout(Math.max(1, context.deadline - Date.now())),
    ]);
    signal.throwIfAborted();
    const request = new Request(input, init);
    const providerKey = new URL(request.url).origin;
    const inputHash = hash({
      url: request.url,
      method: request.method,
      body: await request.clone().text(),
    });
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`model-operation:${context.operationId}:${inputHash}`},0))`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('loreweave:model-admission:v1',0))`;
      await reapModelOwners(tx);
      const [uncertain] =
        await tx`SELECT id FROM model_requests WHERE operation_id=${context.operationId} AND input_hash=${inputHash} AND state IN ('queued','reserved','dispatched','uncertain') LIMIT 1`;
      if (uncertain) throw new Error("provider_uncertain");
      await tx`INSERT INTO model_requests(id,operation_id,input_hash,owner,priority,state,deadline,provider_key,parent_operation_id) VALUES(${id},${context.operationId},${inputHash},${this.owner},${context.priority},'queued',${new Date(context.deadline)},${providerKey},${context.parentOperationId ?? context.operationId})`;
    });
    let dispatched = false;
    try {
      for (;;) {
        signal.throwIfAborted();
        const admitted = await this.sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended('loreweave:model-admission:v1',0))`;
          await reapModelOwners(tx);
          // Older queued ledgers may predate enqueue deduplication. Recheck under
          // the same admission lock before reserving or dispatching their capacity.
          const [competing] =
            await tx`SELECT id FROM model_requests WHERE id<>${id} AND operation_id=${context.operationId} AND input_hash=${inputHash} AND state IN ('reserved','dispatched','uncertain') LIMIT 1`;
          if (competing) throw new Error("provider_uncertain");
          const [capacity] =
            await tx`SELECT count(*)::int AS total,count(*) FILTER(WHERE priority='background')::int AS background,count(*) FILTER(WHERE state='uncertain')::int AS uncertain,count(*) FILTER(WHERE priority='background' AND state='uncertain')::int AS background_uncertain FROM model_requests WHERE state IN ('reserved','dispatched','uncertain') AND capacity_released_at IS NULL`;
          if (
            Number(capacity!.uncertain) >= 8 ||
            (context.priority === "background" &&
              Number(capacity!.background_uncertain) >= 6)
          )
            throw new Error("model_capacity_blocked");
          if (Number(capacity!.total) >= 8) return false;
          const [next] =
            await tx`SELECT id FROM model_requests WHERE state='queued' AND deadline>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM model_provider_cooldowns c WHERE c.provider_key=model_requests.provider_key AND c.until_at>clock_timestamp()) AND (priority='interactive' OR ${Number(capacity!.background)}<6) ORDER BY (priority='interactive') DESC,queued_at,id LIMIT 1`;
          if (next?.id !== id) return false;
          const [row] =
            await tx`UPDATE model_requests SET state='reserved',admitted_at=clock_timestamp() WHERE id=${id} AND owner=${this.owner} AND fence=1 AND state='queued' RETURNING id`;
          return Boolean(row);
        });
        if (admitted) break;
        await pause(20, undefined, { signal });
      }
      signal.throwIfAborted();
      const [intent] = await this
        .sql`UPDATE model_requests SET state='dispatched',dispatched_at=clock_timestamp() WHERE id=${id} AND owner=${this.owner} AND fence=1 AND state='reserved' AND deadline>clock_timestamp() AND EXISTS(SELECT 1 FROM model_owners o WHERE o.id=model_requests.owner AND o.lease_until>clock_timestamp()) RETURNING id`;
      if (!intent) throw new Error("model_authority_lost");
      // A crash after this durable intent is deliberately treated as potentially dispatched.
      signal.throwIfAborted();
      await context.onDispatch?.(id);
      signal.throwIfAborted();
      const transportDeadline = Date.now() + this.settlementMs;
      await this
        .sql`UPDATE model_requests SET transport_deadline=${new Date(transportDeadline)} WHERE id=${id}`;
      signal.throwIfAborted();
      dispatched = true;
      const tracked = modelTransport({
        request,
        caller: context.requestTimeoutMs
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(context.requestTimeoutMs),
            ])
          : signal,
        transport: AbortSignal.any([
          this.authority.signal,
          AbortSignal.timeout(this.settlementMs),
        ]),
        detached: async () => {
          await this
            .sql`UPDATE model_requests SET consumer_ended_at=clock_timestamp() WHERE id=${id} AND owner=${this.owner} AND fence=1`;
        },
        headers: async (response) => {
          const providerId =
            response.headers.get("x-siliconcloud-trace-id") ??
            response.headers.get("x-request-id") ??
            response.headers.get("request-id");
          await this
            .sql`UPDATE model_requests SET response_started_at=clock_timestamp(),response_status=${response.status},provider_request_id=${providerId} WHERE id=${id} AND owner=${this.owner} AND fence=1`;
          if (response.status === 429) {
            const value = response.headers.get("Retry-After");
            const delay =
              value && /^\d+(\.\d+)?$/.test(value)
                ? Number(value) * 1000
                : value
                  ? Math.max(0, Date.parse(value) - Date.now())
                  : 1000;
            const until = new Date(
              Date.now() +
                Math.min(
                  86400000,
                  Number.isFinite(delay) ? Math.max(1000, delay) : 1000,
                ),
            );
            await this
              .sql`INSERT INTO model_provider_cooldowns(provider_key,until_at) VALUES(${providerKey},${until}) ON CONFLICT(provider_key) DO UPDATE SET until_at=greatest(model_provider_cooldowns.until_at,excluded.until_at)`;
          }
        },
        finished: async (state, outcome) => {
          await this
            .sql`UPDATE model_requests SET state=${state},outcome=${outcome},settled_at=CASE WHEN ${state}='settled' THEN clock_timestamp() ELSE NULL END,capacity_released_at=clock_timestamp(),capacity_release=${this.sql.json({ kind: "transport-ended", reference: outcome })} WHERE id=${id} AND owner=${this.owner} AND fence=1 AND state IN ('dispatched','uncertain')`;
        },
      });
      this.transports.set(id, {
        operationId: context.operationId,
        ...(context.parentOperationId
          ? { parentOperationId: context.parentOperationId }
          : {}),
        done: tracked.completion,
      });
      void tracked.completion
        .catch((error) => {
          this.settlementFailure ??= error;
          this.authority.abort(new Error("model_settlement_unrecorded"));
        })
        .finally(() => this.transports.delete(id));
      // Consumer errors do not overwrite transport state. The independent
      // reader above retains ownership until EOF, a terminal marker, or failure.
      return tracked.response;
    } catch (error) {
      await this
        .sql`UPDATE model_requests SET state=${dispatched ? "uncertain" : "expired"},outcome=${dispatched ? "transport_uncertain" : "not_dispatched"},settled_at=${dispatched ? null : new Date()} WHERE id=${id} AND owner=${this.owner} AND fence=1 AND state IN ('queued','reserved','dispatched')`;
      throw error;
    }
  }
  readonly fetch: typeof globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const pending = this.admittedFetch(input, init);
      this.pending.set(pending, work.getStore());
      void pending.finally(() => this.pending.delete(pending)).catch(() => {});
      return pending;
    },
    { preconnect: globalThis.fetch.preconnect },
  );

  async status() {
    const rows = await this
      .sql`SELECT id,operation_id,priority,state,queued_at,admitted_at,dispatched_at,settled_at,deadline,transport_deadline,consumer_ended_at,response_started_at,response_status,provider_request_id,outcome,capacity_released_at,capacity_release,reconciliation FROM model_requests ORDER BY queued_at,id`;
    return {
      limit: 8,
      backgroundLimit: 6,
      active: rows.filter(
        (row) =>
          ["reserved", "dispatched", "uncertain"].includes(row.state) &&
          !row.capacity_released_at,
      ).length,
      blocked: rows.filter(
        (row) => row.state === "uncertain" && !row.capacity_released_at,
      ).length,
      draining: rows.filter(
        (row) =>
          row.state === "dispatched" &&
          row.consumer_ended_at &&
          !row.capacity_released_at,
      ).length,
      uncertain: rows.filter((row) => row.state === "uncertain").length,
      requests: rows,
    };
  }
  async reconcile(
    id: string,
    evidence: {
      kind: "provider-terminated" | "provider-completed";
      reference: string;
    },
  ) {
    if (!evidence.reference.trim())
      throw new Error("reconciliation_evidence_required");
    const [row] = await this
      .sql`UPDATE model_requests SET state='settled',fence=fence+1,settled_at=clock_timestamp(),capacity_released_at=clock_timestamp(),capacity_release=${this.sql.json(evidence)},reconciliation=${this.sql.json(evidence)} WHERE id=${id} AND state='uncertain' AND capacity_released_at IS NOT NULL RETURNING id`;
    if (!row) throw new Error("not_reconcilable");
  }
  async releaseTerminatedClient(id: string, reference: string) {
    if (!reference.trim()) throw new Error("reconciliation_evidence_required");
    const [row] = await this
      .sql`UPDATE model_requests SET state='uncertain',fence=fence+1,capacity_released_at=clock_timestamp(),capacity_release=${this.sql.json({ kind: "client-process-terminated", reference })} WHERE id=${id} AND state IN ('uncertain','dispatched') AND capacity_released_at IS NULL AND NOT EXISTS(SELECT 1 FROM model_owners o WHERE o.id=model_requests.owner AND o.lease_until>clock_timestamp()) RETURNING id`;
    if (!row) throw new Error("client_not_reconcilable");
  }
  async settled(operationId: string) {
    await Promise.allSettled(
      [...this.pending.entries()]
        .filter(
          ([, context]) =>
            context?.operationId === operationId ||
            context?.parentOperationId === operationId,
        )
        .map(([promise]) => promise),
    );
    const pending = [...this.transports.values()].filter(
      (item) =>
        item.operationId === operationId ||
        item.parentOperationId === operationId,
    );
    const results = await Promise.allSettled(pending.map((item) => item.done));
    const failed = results.find((item) => item.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (this.settlementFailure) throw this.settlementFailure;
  }
  close() {
    return (this.closing ??= (async () => {
      this.ingress.abort(new Error("model_admission_closed"));
      await Promise.allSettled([...this.pending.keys()]);
      // Retain heartbeats and the database until every owned response drains.
      await Promise.allSettled(
        [...this.transports.values()].map((item) => item.done),
      );
      this.authority.abort(new Error("model_authority_lost"));
      clearTimeout(this.heartbeat);
      clearTimeout(this.expiry);
      await this.renewal;
      try {
        if (this.starting) {
          await this.starting.catch(() => {});
          await this
            .sql`UPDATE model_owners SET lease_until=clock_timestamp() WHERE id=${this.owner}`;
        }
        if (this.settlementFailure) throw this.settlementFailure;
      } finally {
        await this.sql.end();
      }
    })());
  }
}

/** Fence dead undispatched owners before any replay check, including cache takeover. */
export async function reapModelOwners(tx: postgres.TransactionSql) {
  await tx`UPDATE model_requests r SET state='expired',fence=fence+1,outcome='owner_fenced_before_dispatch',settled_at=clock_timestamp() WHERE state IN ('queued','reserved') AND NOT EXISTS(SELECT 1 FROM model_owners o WHERE o.id=r.owner AND o.lease_until>clock_timestamp())`;
  await tx`UPDATE model_requests r SET state='uncertain',outcome='owner_lost_after_dispatch' WHERE state='dispatched' AND NOT EXISTS(SELECT 1 FROM model_owners o WHERE o.id=r.owner AND o.lease_until>clock_timestamp())`;
  await tx`UPDATE model_requests SET state='expired',outcome='queue_deadline' ,settled_at=clock_timestamp() WHERE state='queued' AND deadline<=clock_timestamp()`;
}
