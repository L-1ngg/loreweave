import { expect, test } from "bun:test";
import { PostgresConversations } from "../src/conversations.ts";
import type { SessionEntry } from "@forge-agent/core/sdk";

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error("TEST_DATABASE_URL is required for persistence tests");

test("acknowledged Forge history survives reconnect with native IDs and selected leaf", async () => {
  const store = new PostgresConversations(url);
  await store.migrate();
  const conversation = await store.create();
  const writer = await store.acquire(conversation.id);
  expect(writer).not.toBeNull();
  const entry: SessionEntry = {
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: "2026-09-10T00:00:00.000Z",
    type: "message",
    message: {
      role: "user",
      timestamp: 1788998400000,
      content: [{ type: "text", text: "保留原始记录" }],
    },
  };
  try {
    await writer!.storage.append(entry);
    expect(await store.read(conversation.id)).toEqual({
      id: conversation.id,
      entries: [entry],
      leafId: entry.id,
    });
    await writer!.release();
    const reconnected = new PostgresConversations(url);
    try {
      expect(await reconnected.read(conversation.id)).toEqual({
        id: conversation.id,
        entries: [entry],
        leafId: entry.id,
      });
    } finally {
      await reconnected.close();
    }
  } finally {
    await writer!.release();
    await store.close();
  }
});

test("only one writer can append and released writers cannot alter history", async () => {
  const first = new PostgresConversations(url);
  const second = new PostgresConversations(url);
  await first.migrate();
  const conversation = await first.create();
  const a = await first.acquire(conversation.id);
  try {
    expect(await second.acquire(conversation.id)).toBeNull();
    await a!.release();
    const b = await second.acquire(conversation.id);
    try {
      expect(b).not.toBeNull();
      await expect(
        a!.storage.append({
          id: crypto.randomUUID(),
          parentId: null,
          timestamp: new Date().toISOString(),
          type: "message",
          message: { role: "user", content: [], timestamp: Date.now() },
        }),
      ).rejects.toThrow("stale_writer");
      expect((await second.read(conversation.id)).entries).toHaveLength(0);
    } finally {
      await b!.release();
    }
  } finally {
    await a!.release();
    await first.close();
    await second.close();
  }
});

test("a second host reconnects to the same durable run and acknowledged history", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const provider = startScriptedProvider({ delayMs: 30 });
  const options = {
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  };
  const host = new KnowledgeHost(options);
  const reader = new KnowledgeHost(options);
  try {
    const run = await host.start({ question: "日志保留多久？" });
    expect((await reader.get(run.id)).id).toBe(run.id);
    await host.settled(run.id);
    const result = await reader.get(run.id);
    expect(result.status).toBe("answered");
    expect(result.counts.exploration).toBe(2);
    const history = await store.read(result.conversationId);
    expect(history.entries.length).toBeGreaterThan(2);
    expect(history.leafId).toBe(history.entries.at(-1)!.id);
    expect((await reader.events(run.id)).at(-1)!.type).toBe("settled");
    expect(provider.calls).toHaveLength(4);
  } finally {
    await host.close();
    await reader.close();
    provider.stop();
    await store.close();
  }
});

test("same-conversation turns queue across hosts while another conversation progresses", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const provider = startScriptedProvider({ delayMs: 100 });
  const options = {
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  };
  const a = new KnowledgeHost(options),
    b = new KnowledgeHost(options);
  try {
    const first = await a.start({ question: "第一轮" });
    const next = await b.start({
      question: "下一轮",
      conversationId: first.conversationId,
    });
    const other = await b.start({ question: "独立会话" });
    expect((await b.get(next.id)).status).toBe("queued");
    const startedBy = Date.now() + 1000;
    while (
      (await b.get(other.id)).status === "queued" &&
      Date.now() < startedBy
    )
      await Bun.sleep(10);
    expect((await b.get(other.id)).status).toBe("executing");
    await a.cancel(first.id);
    await a.settled(first.id);
    await b.settled(next.id);
    expect((await b.get(next.id)).settledAt).toBeDefined();
    const events = await b.events(next.id);
    const executing = events.find((event) => event.run.status === "executing");
    expect(executing).toBeDefined();
  } finally {
    await a.close();
    await b.close();
    provider.stop();
    await store.close();
  }
});

test("refresh reconnect preserves the abandoned draft identity and consumed budgets", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const sources = new FixtureSources();
  let changed = false;
  const provider = startScriptedProvider({
    onRequest(phase) {
      if (phase === "review" && !changed) {
        changed = true;
        sources.replace("日志保留 60 天。");
      }
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations: store,
  });
  try {
    const run = await host.start({ question: "日志保留多久" });
    await host.settled(run.id);
    const events = await host.events(run.id);
    const refresh = events.find((event) => event.run.status === "refreshing")!;
    expect(refresh.run.refreshUsed).toBe(true);
    expect(refresh.run.supersededDraftIds).toHaveLength(1);
    expect(refresh.run.counts.generation).toBe(1);
    expect(refresh.run.counts.review).toBe(1);
    const result = await store.run(run.id);
    expect(result.status).toBe("answered");
    expect(result.supersededDraftIds).not.toContain(result.draftId!);
    expect(result.deadline).toBe(run.deadline);
  } finally {
    await host.close();
    provider.stop();
    await store.close();
  }
});

test("interrupted finalization is reported without replay or premature settlement", async () => {
  const store = new PostgresConversations(url);
  await store.migrate();
  const conversation = await store.create();
  const snapshot = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    deadline: Date.now() + 30000,
    status: "queued" as const,
    counts: { exploration: 2, generation: 1, review: 0, retrieval: 1 },
    draftId: crypto.randomUUID(),
  };
  await store.register(snapshot, "中断的查询", snapshot.deadline);
  const writer = await store.acquire(conversation.id, snapshot.id);
  await writer!.save({
    sequence: 1,
    type: "state",
    run: { ...snapshot, status: "finalizing" },
  });
  // Lost database session alone does not prove that external work has terminated.
  await writer!.release();
  try {
    const recovered = await store.reconcile(snapshot.id);
    expect(recovered.status).toBe("failed");
    expect(recovered.reason).toBe("answer_generation_interrupted");
    expect(recovered.settledAt).toBeUndefined();
    expect(recovered.counts.generation).toBe(1);
    expect(recovered.draftId).toBe(snapshot.draftId);
    const settled = await store.reconcile(snapshot.id, {
      executionTerminated: true,
    });
    expect(settled.settledAt).toBeDefined();
    expect(
      (await store.events(snapshot.id, 0)).map((event) => event.type),
    ).toEqual(["state", "result", "settled"]);
  } finally {
    await store.close();
  }
});

test("storage uncertainty faults the turn and cancellation keeps its slot until append settles", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  let entered!: () => void, release!: () => void;
  const appending = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  class FailingStorage extends PostgresConversations {
    blocked = false;
    override async acquire(id: string, runId?: string) {
      const writer = await super.acquire(id, runId);
      if (!writer || this.blocked) return writer;
      this.blocked = true;
      return {
        ...writer,
        storage: {
          ...writer.storage,
          append: async () => {
            entered();
            await gate;
            throw new Error("injected_storage_failure");
          },
        },
      };
    }
  }
  const store = new FailingStorage(url);
  await store.migrate();
  const provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  });
  try {
    const first = await host.start({ question: "取消持久化中的查询" });
    await appending;
    const next = await host.start({
      question: "下一条",
      conversationId: first.conversationId,
    });
    await host.cancel(first.id);
    expect((await host.get(first.id)).status).toBe("canceled");
    expect((await host.get(first.id)).settledAt).toBeUndefined();
    expect((await host.get(next.id)).status).toBe("queued");
    expect(provider.calls).toHaveLength(0);
    release();
    await host.settled(first.id);
    expect((await host.get(first.id)).status).toBe("canceled");
    expect((await host.get(first.id)).reason).toBe("storage_uncertain");
    expect((await host.get(first.id)).settledAt).toBeDefined();
  } finally {
    release();
    await host.close();
    provider.stop();
    await store.close();
  }
});

test("missing historical tool results retain raw history and require reconciliation without model replay", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const conversation = await store.create();
  const writer = await store.acquire(conversation.id);
  const missing: SessionEntry = {
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    type: "message",
    message: {
      role: "assistant",
      timestamp: Date.now(),
      content: [
        {
          type: "tool_call",
          id: "unknown-effect",
          name: "update_source",
          arguments: {},
        },
      ],
    },
  };
  await writer!.storage.append(missing);
  await writer!.release();
  const provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  });
  try {
    const run = await host.start({
      question: "继续",
      conversationId: conversation.id,
    });
    await host.settled(run.id);
    expect((await host.get(run.id)).reason).toBe(
      "history_requires_reconciliation",
    );
    expect(provider.calls).toHaveLength(0);
    expect((await store.read(conversation.id)).entries).toEqual([missing]);
  } finally {
    await host.close();
    provider.stop();
    await store.close();
  }
});

test("a disconnected database writer cannot append after a replacement acquires its fence", async () => {
  const postgres = (await import("postgres")).default;
  const fault = postgres(url, { max: 1 });
  const first = new PostgresConversations(url),
    second = new PostgresConversations(url);
  await first.migrate();
  const conversation = await first.create();
  const old = await first.acquire(conversation.id);
  try {
    // Infrastructure fault injection: terminate the session holding this conversation's lock.
    await fault`SELECT pg_terminate_backend(pid) FROM pg_locks
      WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${conversation.id}, 0)`;
    const replacement = await second.acquire(conversation.id);
    expect(replacement).not.toBeNull();
    try {
      const entry: SessionEntry = {
        id: crypto.randomUUID(),
        parentId: null,
        timestamp: new Date().toISOString(),
        type: "message",
        message: { role: "user", timestamp: Date.now(), content: [] },
      };
      await replacement!.storage.append(entry);
      await expect(
        old!.storage.append({
          ...entry,
          id: crypto.randomUUID(),
          parentId: entry.id,
        }),
      ).rejects.toThrow();
      expect((await second.read(conversation.id)).entries).toEqual([entry]);
    } finally {
      await replacement!.release();
    }
  } finally {
    await old!.release();
    await first.close();
    await second.close();
    await fault.end();
  }
});

test("later turns in a reloaded conversation retrieve fresh evidence instead of reusing an earlier turn", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const sources = new FixtureSources(),
    provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations: store,
  });
  try {
    let conversationId: string | undefined;
    for (let i = 0; i < 4; i++) {
      sources.replace(`日志保留 ${30 + i} 天。`);
      const run = await host.start({
        question: "现在保留多久？",
        ...(conversationId ? { conversationId } : {}),
      });
      conversationId = run.conversationId;
      await host.settled(run.id);
      expect((await host.get(run.id)).status).toBe("answered");
      expect((await host.get(run.id)).answer?.text).toContain(`${30 + i} 天`);
    }
    expect(provider.calls).toHaveLength(16);
  } finally {
    await host.close();
    provider.stop();
    await store.close();
  }
});

test("a replacement host cancels or expires acknowledged queued runs without replay", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const provider = startScriptedProvider();
  const reader = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  });
  try {
    for (const canceled of [true, false]) {
      const conversation = await store.create();
      const run = {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        status: "queued" as const,
        deadline: Date.now() + (canceled ? 30000 : -1),
        counts: { exploration: 0, generation: 0, review: 0, retrieval: 0 },
      };
      await store.register(run, "原进程已确认接收的排队查询", run.deadline);
      await store.saveQueued({ sequence: 1, type: "state", run });
      if (canceled) await reader.cancel(run.id);
      const result = await reader.get(run.id);
      expect(result.status).toBe(canceled ? "canceled" : "timed_out");
      expect(result.settledAt).toBeDefined();
      expect((await reader.events(run.id)).map((event) => event.type)).toEqual([
        "state",
        "result",
        "settled",
      ]);
      const next = await reader.start({
        question: "新查询",
        conversationId: conversation.id,
      });
      await reader.settled(next.id);
      expect((await reader.get(next.id)).status).toBe("answered");
    }
    expect(provider.calls).toHaveLength(8);
  } finally {
    await reader.close();
    provider.stop();
    await store.close();
  }
});

test("remote cancellation settles an unclaimed queued run without taking its live predecessor's writer", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const provider = startScriptedProvider({ delayMs: 300 });
  const options = {
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  };
  const owner = new KnowledgeHost(options),
    observer = new KnowledgeHost(options);
  try {
    const first = await owner.start({ question: "仍在执行" });
    const queued = await owner.start({
      question: "等待中",
      conversationId: first.conversationId,
    });
    expect((await observer.get(queued.id)).status).toBe("queued");
    await observer.cancel(queued.id);
    expect((await observer.get(queued.id)).status).toBe("canceled");
    expect((await observer.get(queued.id)).settledAt).toBeDefined();
    expect((await observer.get(first.id)).settledAt).toBeUndefined();
    await owner.settled(queued.id);
    expect((await observer.get(first.id)).status).toBe("executing");
  } finally {
    await owner.close();
    await observer.close();
    provider.stop();
    await store.close();
  }
});

test("concurrent owner cancellation and remote queue inspection acknowledge the same stopped run", async () => {
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const store = new PostgresConversations(url);
  await store.migrate();
  const provider = startScriptedProvider({ delayMs: 100 });
  const options = {
    providerUrl: provider.url,
    sources: new FixtureSources(),
    conversations: store,
  };
  const owner = new KnowledgeHost(options),
    observer = new KnowledgeHost(options);
  try {
    const run = await owner.start({ question: "取消竞争" });
    await Promise.all([
      owner.cancel(run.id),
      observer.cancel(run.id),
      observer.get(run.id),
    ]);
    await owner.settled(run.id);
    expect((await observer.get(run.id)).status).toBe("canceled");
    expect((await observer.get(run.id)).settledAt).toBeDefined();
    expect(provider.calls).toHaveLength(0);
  } finally {
    await owner.close();
    await observer.close();
    provider.stop();
    await store.close();
  }
});

for (const boundary of ["generation", "refreshing", "settled"] as const) {
  test(`Host retains ownership while ${boundary} persistence is pending`, async () => {
    const { KnowledgeHost } = await import("../src/host.ts");
    const { FixtureSources } = await import("../src/development/sources.ts");
    const { startScriptedProvider } =
      await import("../src/development/provider.ts");
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    class DelayedStore extends PostgresConversations {
      held = false;
      override async acquire(id: string, runId?: string) {
        const writer = await super.acquire(id, runId);
        if (!writer) return writer;
        return {
          ...writer,
          save: async (event: import("../src/host.ts").RunEvent) => {
            const matches =
              boundary === "generation"
                ? event.type === "progress" && event.run.counts.generation === 1
                : boundary === "refreshing"
                  ? event.type === "state" && event.run.status === "refreshing"
                  : event.type === "settled";
            if (!this.held && matches) {
              this.held = true;
              entered();
              await gate;
            }
            await writer.save(event);
          },
        };
      }
    }
    const store = new DelayedStore(url!);
    await store.migrate();
    const sources = new FixtureSources();
    const provider = startScriptedProvider({
      onRequest(phase) {
        if (boundary === "refreshing" && phase === "generation")
          sources.replace("日志保留 60 天。");
      },
    });
    const host = new KnowledgeHost({
      providerUrl: provider.url,
      sources,
      conversations: store,
    });
    try {
      const first = await host.start({ question: "日志保留多久？" });
      await blocked;
      let settled = false;
      void host.settled(first.id).then(() => {
        settled = true;
      });
      const next = await host.start({
        question: "下一条",
        conversationId: first.conversationId,
      });
      expect((await host.get(first.id)).settledAt).toBeUndefined();
      expect((await host.get(next.id)).status).toBe("queued");
      expect(settled).toBe(false);
      const calls = provider.calls.length;
      await host.cancel(next.id);
      if (boundary !== "settled") {
        const canceled = host.cancel(first.id);
        while (!(await store.cancellationRequested(first.id)))
          await Bun.sleep(1);
        // Let the cancel continuation abort the run while its event save is blocked.
        await Promise.resolve();
        release();
        await canceled;
      } else release();
      await host.settled(first.id);
      const result = await host.get(first.id);
      expect(result.settledAt).toBeDefined();
      expect(result.status).toBe(
        boundary === "settled" ? "answered" : "canceled",
      );
      if (boundary !== "settled") {
        expect(result.answer).toBeUndefined();
        expect(provider.calls).toHaveLength(calls);
        expect(provider.calls.some((call) => call.phase === "review")).toBe(
          false,
        );
      }
    } finally {
      release();
      await host.close();
      provider.stop();
      await store.close();
    }
  });
}
