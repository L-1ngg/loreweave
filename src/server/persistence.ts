import {
  defineAIPersistence,
  defineMessageStore,
  defineRunStore,
} from "@tanstack/ai-persistence";
import { eq, and, sql, asc } from "drizzle-orm";
import { database } from "./database";
import { chatThreads, sdkRuns } from "./schema";

export const messages = defineMessageStore({
  async loadThread(threadId) {
    const [row] = await database()
      .db.select()
      .from(chatThreads)
      .where(eq(chatThreads.threadId, threadId));
    return row?.messages ?? [];
  },
  async saveThread(threadId, next) {
    await database()
      .db.insert(chatThreads)
      .values({ threadId, messages: next })
      .onConflictDoUpdate({
        target: chatThreads.threadId,
        set: { messages: next },
      });
  },
});
export const runs = defineRunStore({
  async createOrResume(input) {
    await database()
      .db.insert(sdkRuns)
      .values({
        runId: input.runId,
        threadId: input.threadId,
        record: { ...input, status: input.status ?? "running" },
      })
      .onConflictDoNothing();
    return (await this.get(input.runId))!;
  },
  async update(runId, patch) {
    await database().db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(sdkRuns)
        .where(eq(sdkRuns.runId, runId))
        .for("update");
      if (old)
        await tx
          .update(sdkRuns)
          .set({ record: { ...old.record, ...patch } })
          .where(eq(sdkRuns.runId, runId));
    });
  },
  async get(runId) {
    const [row] = await database()
      .db.select()
      .from(sdkRuns)
      .where(eq(sdkRuns.runId, runId));
    return row?.record ?? null;
  },
  async findActiveRun(threadId) {
    const rows = await database()
      .db.select()
      .from(sdkRuns)
      .where(
        and(
          eq(sdkRuns.threadId, threadId),
          sql`${sdkRuns.record}->>'status' = 'running'`,
        ),
      )
      .orderBy(sql`(${sdkRuns.record}->>'startedAt')::bigint DESC`)
      .limit(1);
    return rows[0]?.record ?? null;
  },
  async listByThread(threadId) {
    return (
      await database()
        .db.select()
        .from(sdkRuns)
        .where(eq(sdkRuns.threadId, threadId))
        .orderBy(sql`(${sdkRuns.record}->>'startedAt')::bigint ASC`)
    ).map((r) => r.record);
  },
});
export const persistence = defineAIPersistence({ stores: { messages, runs } });
