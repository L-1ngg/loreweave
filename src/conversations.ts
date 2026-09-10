import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type {
  SessionEntry,
  SessionState,
  SessionStorage,
} from "@forge-agent/core/sdk";

import type { RunEvent, RunSnapshot } from "./host.ts";

export interface Conversation extends SessionState {
  id: string;
  organizationId?: string;
}
export interface ConversationWriter {
  storage: SessionStorage;
  save(event: RunEvent): Promise<void>;
  release(): Promise<void>;
}

/** A dedicated database session owns the advisory lock until SDK cleanup finishes. */
export class PostgresConversations {
  private readonly client;
  private readonly db;
  constructor(private readonly url: string) {
    this.client = postgres(url, { max: 12, onnotice: () => {} });
    this.db = drizzle(this.client);
  }
  async migrate(): Promise<void> {
    await migrate(this.db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
  }
  async register(
    snapshot: RunSnapshot,
    question: string,
    deadline: number,
  ): Promise<void> {
    await this.db
      .execute(sql`INSERT INTO conversation_runs(id, conversation_id, snapshot, question, deadline)
      VALUES (${snapshot.id}, ${snapshot.conversationId}, ${JSON.stringify(snapshot)}::jsonb, ${question}, ${deadline})`);
  }
  async run(id: string): Promise<RunSnapshot> {
    let snapshot = await this.storedRun(id);
    if (snapshot.status === "queued")
      snapshot = await this.settleStoppedQueue(id);
    if (!snapshot.settledAt) {
      const rows = await this.db.execute(
        sql`SELECT writer_fence FROM conversation_runs WHERE id = ${id}`,
      );
      if (rows[0]?.writer_fence !== null) return this.reconcile(id);
    }
    return snapshot;
  }
  private async settleStoppedQueue(id: string): Promise<RunSnapshot> {
    return this.db.transaction(async (tx) => {
      const rows =
        await tx.execute(sql`SELECT snapshot, writer_fence, cancel_requested,
        deadline <= extract(epoch FROM clock_timestamp()) * 1000 AS expired
        FROM conversation_runs WHERE id = ${id} FOR UPDATE`);
      if (!rows[0]) throw new Error("not_found");
      const row = rows[0];
      const snapshot = row.snapshot as RunSnapshot;
      if (
        snapshot.status !== "queued" ||
        snapshot.settledAt ||
        row.writer_fence !== null ||
        (!row.cancel_requested && !row.expired)
      )
        return snapshot;
      snapshot.status = row.cancel_requested ? "canceled" : "timed_out";
      snapshot.reason = row.cancel_requested ? "canceled" : "budget_exhausted";
      const last = await tx.execute(
        sql`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM run_events WHERE run_id = ${id}`,
      );
      const sequence = Number(last[0]!.sequence);
      const outcome: RunEvent = {
        sequence: sequence + 1,
        type: "result",
        run: structuredClone(snapshot),
      };
      snapshot.settledAt = new Date().toISOString();
      const settled: RunEvent = {
        sequence: sequence + 2,
        type: "settled",
        run: snapshot,
      };
      await tx.execute(
        sql`UPDATE conversation_runs SET snapshot = ${JSON.stringify(snapshot)}::jsonb WHERE id = ${id}`,
      );
      await tx.execute(sql`INSERT INTO run_events(run_id, sequence, event) VALUES
        (${id}, ${outcome.sequence}, ${JSON.stringify(outcome)}::jsonb),
        (${id}, ${settled.sequence}, ${JSON.stringify(settled)}::jsonb)`);
      return snapshot;
    });
  }
  private async storedRun(id: string): Promise<RunSnapshot> {
    const rows = await this.db.execute(
      sql`SELECT snapshot FROM conversation_runs WHERE id = ${id}`,
    );
    if (!rows[0]) throw new Error("not_found");
    return rows[0].snapshot as RunSnapshot;
  }
  /** Operator confirmation concerns process/tool termination, not merely lock availability. */
  async reconcile(
    id: string,
    options: { executionTerminated?: true } = {},
  ): Promise<RunSnapshot> {
    const previous = await this.storedRun(id);
    if (previous.settledAt) return previous;
    const writer = await this.acquireWriter(previous.conversationId, id, true);
    if (!writer) return this.storedRun(id);
    try {
      const current = await this.storedRun(id);
      if (current.settledAt) return current;
      const interrupted = current.reason?.endsWith("_interrupted");
      if (interrupted && !options.executionTerminated) return current;
      if (
        !["answered", "partial", "canceled", "timed_out"].includes(
          current.status,
        )
      ) {
        current.reason = interrupted
          ? current.reason!
          : ["finalizing", "refreshing"].includes(current.status)
            ? "answer_generation_interrupted"
            : "execution_interrupted";
        current.status = "failed";
      } else {
        current.reason = "execution_interrupted";
      }
      if (options.executionTerminated)
        current.settledAt = new Date().toISOString();
      const events = await this.events(id, 0);
      await writer.save({
        sequence: (events.at(-1)?.sequence ?? 0) + 1,
        type: options.executionTerminated ? "settled" : "result",
        run: current,
      });
      return current;
    } finally {
      await writer.release();
    }
  }
  async runs(id: string): Promise<RunSnapshot[]> {
    const rows = await this.db.execute(
      sql`SELECT snapshot FROM conversation_runs WHERE conversation_id = ${id} ORDER BY ordinal`,
    );
    return rows.map((row) => row.snapshot as RunSnapshot);
  }
  async events(id: string, after: number): Promise<RunEvent[]> {
    const rows = await this.db.execute(
      sql`SELECT event FROM run_events WHERE run_id = ${id} AND sequence > ${after} ORDER BY sequence`,
    );
    return rows.map((row) => row.event as RunEvent);
  }
  async requestCancel(id: string): Promise<void> {
    const rows = await this.db.execute(
      sql`UPDATE conversation_runs SET cancel_requested = true WHERE id = ${id} RETURNING id`,
    );
    if (!rows.length) throw new Error("not_found");
  }
  async cancellationRequested(id: string): Promise<boolean> {
    const rows = await this.db.execute(
      sql`SELECT cancel_requested FROM conversation_runs WHERE id = ${id}`,
    );
    return rows[0]?.cancel_requested === true;
  }
  async saveQueued(event: RunEvent): Promise<void> {
    const rows = await this.db.execute(sql`WITH changed AS (
      UPDATE conversation_runs SET snapshot = ${JSON.stringify(event.run)}::jsonb
      WHERE id = ${event.run.id} AND writer_fence IS NULL AND NOT (snapshot ? 'settledAt') RETURNING id
    ) INSERT INTO run_events(run_id, sequence, event)
      SELECT id, ${event.sequence}, ${JSON.stringify(event)}::jsonb FROM changed RETURNING run_id`);
    if (!rows.length) {
      // Another observer can atomically settle this never-claimed queue entry.
      // A repeated stop acknowledges that durable outcome without appending or
      // replacing its already committed events. Admission/state writes still fail.
      const recorded = await this.storedRun(event.run.id);
      if (
        (event.type === "result" || event.type === "settled") &&
        recorded.settledAt &&
        ["canceled", "timed_out"].includes(recorded.status)
      )
        return;
      throw new Error("stale_writer");
    }
  }
  async organizationOfRun(id: string): Promise<string | null> {
    const rows = await this.db.execute(
      sql`SELECT c.organization_id FROM conversation_runs r JOIN conversations c ON c.id = r.conversation_id WHERE r.id = ${id}`,
    );
    if (!rows[0]) throw new Error("not_found");
    return rows[0].organization_id as string | null;
  }
  async create(organizationId?: string): Promise<Conversation> {
    const id = crypto.randomUUID();
    await this.db.execute(
      sql`INSERT INTO conversations(id, organization_id) VALUES (${id}, ${organizationId ?? null})`,
    );
    return {
      id,
      entries: [],
      leafId: null,
      ...(organizationId ? { organizationId } : {}),
    };
  }
  async read(id: string): Promise<Conversation> {
    const rows = await this.db
      .execute(sql`SELECT c.id, c.leaf_id, c.organization_id,
      COALESCE((SELECT jsonb_agg(e.entry ORDER BY e.ordinal) FROM session_entries e
        WHERE e.conversation_id = c.id), '[]'::jsonb) AS entries
      FROM conversations c WHERE c.id = ${id}`);
    const row = rows[0];
    if (!row) throw new Error("not_found");
    return {
      id: String(row.id),
      ...(row.organization_id
        ? { organizationId: String(row.organization_id) }
        : {}),
      leafId: row.leaf_id as string | null,
      entries: row.entries as SessionEntry[],
    };
  }
  async acquire(
    id: string,
    runId?: string,
  ): Promise<ConversationWriter | null> {
    return this.acquireWriter(id, runId);
  }
  private async acquireWriter(
    id: string,
    runId?: string,
    recovering = false,
  ): Promise<ConversationWriter | null> {
    // postgres reserved handles cannot reconnect safely after a socket loss.
    // A dedicated single-connection client preserves session affinity and faults
    // the writer on close; backend/fence checks also reject any driver reconnect.
    let disconnected = false;
    const connection = postgres(this.url, {
      max: 1,
      idle_timeout: 0,
      max_lifetime: 0,
      onnotice: () => {},
      onclose: () => {
        disconnected = true;
      },
    });
    let locked = false;
    try {
      const [result] =
        await connection`SELECT pg_try_advisory_lock(hashtextextended(${id}, 0)) AS acquired`;
      if (!result?.acquired) {
        await connection.end({ timeout: 1 });
        return null;
      }
      locked = true;
      if (runId) {
        const [first] =
          await connection`SELECT id FROM conversation_runs WHERE conversation_id = ${id}
          AND NOT (snapshot ? 'settledAt') ORDER BY ordinal LIMIT 1`;
        if (first?.id !== runId) {
          if (!disconnected)
            await connection`SELECT pg_advisory_unlock(hashtextextended(${id}, 0))`;
          await connection.end({ timeout: 1 });
          return null;
        }
      }
      const [row] =
        await connection`UPDATE conversations SET fence = fence + 1 WHERE id = ${id} RETURNING fence, pg_backend_pid() AS backend`;
      if (!row) throw new Error("not_found");
      const fence = row.fence;
      const backend = row.backend;
      if (runId && !recovering) {
        const claimed =
          await connection`UPDATE conversation_runs SET writer_fence = ${fence}
          WHERE id = ${runId} AND writer_fence IS NULL AND snapshot->>'status' = 'queued'
            AND NOT (snapshot ? 'settledAt') RETURNING id`;
        if (!claimed.length) {
          await connection`SELECT pg_advisory_unlock(hashtextextended(${id}, 0))`;
          await connection.end();
          return null;
        }
      }
      let released = false;
      const storage: SessionStorage = {
        load: async () => {
          if (released || disconnected) throw new Error("stale_writer");
          const { entries, leafId } = await this.read(id);
          return { entries, leafId };
        },
        append: async (entry) => {
          if (released || disconnected) throw new Error("stale_writer");
          const rows = await connection`WITH selected AS (
            UPDATE conversations SET leaf_id = ${entry.id}
            WHERE id = ${id} AND fence = ${fence} AND pg_backend_pid() = ${backend}
              AND leaf_id IS NOT DISTINCT FROM ${entry.parentId}::uuid
            RETURNING id
          ) INSERT INTO session_entries(conversation_id, id, entry)
            SELECT id, ${entry.id}, ${connection.json(entry as unknown as postgres.JSONValue)}::jsonb
            FROM selected RETURNING id`;
          if (!rows.length) throw new Error("stale_writer_or_invalid_parent");
        },
      };
      return {
        storage,
        save: async (event) => {
          if (released || disconnected || event.run.id !== runId)
            throw new Error("stale_writer");
          const rows = await connection`WITH changed AS (
          UPDATE conversation_runs r SET snapshot = ${connection.json(event.run as unknown as postgres.JSONValue)}::jsonb, writer_fence = ${fence}
          FROM conversations c WHERE r.id = ${runId!} AND r.conversation_id = c.id
          AND c.fence = ${fence} AND pg_backend_pid() = ${backend}
          RETURNING r.id
        ) INSERT INTO run_events(run_id, sequence, event)
          SELECT id, ${event.sequence}, ${connection.json(event as unknown as postgres.JSONValue)}::jsonb FROM changed RETURNING run_id`;
          if (!rows.length) throw new Error("stale_writer");
        },
        release: async () => {
          if (released) return;
          released = true;
          try {
            if (!disconnected)
              await connection`SELECT pg_advisory_unlock(hashtextextended(${id}, 0))`;
          } finally {
            await connection.end({ timeout: 1 });
          }
        },
      };
    } catch (error) {
      try {
        if (locked)
          if (!disconnected)
            await connection`SELECT pg_advisory_unlock(hashtextextended(${id}, 0))`;
      } finally {
        await connection.end({ timeout: 1 });
      }
      throw error;
    }
  }
  async close(): Promise<void> {
    await this.client.end();
  }
}
