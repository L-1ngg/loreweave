import { expect, test } from "bun:test";
import { KnowledgeHost } from "../src/host.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";

test("a knowledge turn returns a reviewed cited fixture answer, not Forge exploration text", async () => {
  const provider = startScriptedProvider();
  const sources = new FixtureSources();
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  try {
    const run = await host.start({ question: "项目日志保留多久？" });
    await host.settled(run.id);
    const answer = await host.get(run.id);
    expect(answer.status).toBe("answered");
    expect(answer.answer?.text).toContain("30 天");
    expect(answer.answer?.text).not.toContain("Exploration");
    expect(answer.answer?.citations[0]?.version).toBe("v1");
    expect(provider.calls.map((call) => call.phase)).toEqual([
      "task",
      "task",
      "generation",
      "review",
    ]);
    expect(answer.counts).toEqual({
      exploration: 2,
      generation: 1,
      review: 1,
      retrieval: 1,
    });
  } finally {
    await host.close();
    provider.stop();
  }
});

test("cancel stops the model turn and exposes settlement separately from its outcome", async () => {
  const provider = startScriptedProvider({ delayMs: 80 });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "取消这次查询" });
    await host.cancel(run.id);
    expect((await host.get(run.id)).status).toBe("canceled");
    await host.settled(run.id);
    expect((await host.get(run.id)).settledAt).toBeDefined();
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("the original deadline terminates slow final generation without unreviewed delivery", async () => {
  const provider = startScriptedProvider({ delays: { generation: 300 } });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    timing: { ordinaryMs: 100, ordinaryReserveMs: 30 },
  });
  try {
    const run = await host.start({ question: "慢查询" });
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("timed_out");
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect(provider.calls.some((call) => call.phase === "review")).toBe(false);
    expect((await host.get(run.id)).settledAt).toBeDefined();
  } finally {
    await host.close();
    provider.stop();
  }
});

test("a source change during final generation uses one remaining round and regenerates before review", async () => {
  const sources = new FixtureSources();
  let changed = false;
  const provider = startScriptedProvider({
    onRequest(phase) {
      if (phase === "generation" && !changed) {
        changed = true;
        sources.replace("演示项目的应用日志保留 60 天。");
      }
    },
  });
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  try {
    const run = await host.start({ question: "项目日志保留多久？" });
    await host.settled(run.id);
    const answer = await host.get(run.id);
    expect(answer.status).toBe("answered");
    expect(answer.answer?.text).toContain("60 天");
    expect(answer.answer?.citations[0]?.version).toBe("v2");
    expect(answer.counts).toEqual({
      exploration: 2,
      generation: 2,
      review: 1,
      retrieval: 2,
    });
    expect(answer.refreshUsed).toBe(true);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("a rejected draft is regenerated and reviewed within the same finalization allowance", async () => {
  const provider = startScriptedProvider({ rejectReviews: 1 });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "检查回答" });
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("answered");
    expect((await host.get(run.id)).counts.generation).toBe(2);
    expect((await host.get(run.id)).counts.review).toBe(2);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("five active runs and ten queued runs bound development admission", async () => {
  const provider = startScriptedProvider({ delayMs: 300 });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const runs = [];
    for (let i = 0; i < 15; i++)
      runs.push(await host.start({ question: "排队查询" }));
    expect((await host.get(runs[5]!.id)).status).toBe("queued");
    await expect(host.start({ question: "超出队列" })).rejects.toThrow(
      "unavailable",
    );
    await host.cancel(runs[5]!.id);
    await host.settled(runs[5]!.id);
    expect((await host.get(runs[5]!.id)).status).toBe("canceled");
  } finally {
    await host.close();
    provider.stop();
  }
});

test("repair and exploration together never exceed seven actual model requests", async () => {
  const provider = startScriptedProvider({
    repeatTool: true,
    rejectReviews: 2,
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "继续检查" });
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("failed");
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect((await host.get(run.id)).counts).toEqual({
      exploration: 3,
      generation: 2,
      review: 2,
      retrieval: 2,
    });
    expect(provider.calls).toHaveLength(7);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("a second source change cannot obtain another refresh or publish stale text", async () => {
  const sources = new FixtureSources();
  const provider = startScriptedProvider({
    onRequest(phase) {
      if (phase === "generation") sources.replace("更新后的日志保留规则。");
    },
  });
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  try {
    const run = await host.start({ question: "日志规则" });
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("failed");
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect((await host.get(run.id)).counts).toEqual({
      exploration: 2,
      generation: 2,
      review: 0,
      retrieval: 2,
    });
    expect(
      (await host.events(run.id)).filter(
        (event) => event.run.status === "refreshing",
      ),
    ).toHaveLength(1);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("source change during review consumes the remaining pair without restarting Forge", async () => {
  const sources = new FixtureSources();
  let changed = false;
  const provider = startScriptedProvider({
    onRequest(phase) {
      if (phase === "review" && !changed) {
        changed = true;
        sources.replace("应用日志保留 60 天。");
      }
    },
  });
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  try {
    const run = await host.start({ question: "日志规则" });
    await host.settled(run.id);
    expect((await host.get(run.id)).answer?.citations[0]?.version).toBe("v2");
    expect((await host.get(run.id)).counts).toEqual({
      exploration: 2,
      generation: 2,
      review: 2,
      retrieval: 2,
    });
    const phases = (await host.events(run.id))
      .filter((event) => event.type === "state")
      .map((event) => event.run.status);
    expect(phases).toEqual([
      "queued",
      "executing",
      "finalizing",
      "refreshing",
      "finalizing",
    ]);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("canceling in-flight final generation never starts support review", async () => {
  let started!: () => void;
  const generation = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider = startScriptedProvider({
    delays: { generation: 300 },
    onRequest(phase) {
      if (phase === "generation") started();
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志规则" });
    await generation;
    await host.cancel(run.id);
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("canceled");
    expect(provider.calls.some((call) => call.phase === "review")).toBe(false);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("canceling in-flight review never publishes the generated draft or starts repair", async () => {
  let entered!: () => void;
  const reviewing = new Promise<void>((resolve) => (entered = resolve));
  const provider = startScriptedProvider({
    delays: { review: 300 },
    rejectReviews: 1,
    onRequest(phase) {
      if (phase === "review") entered();
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志规则" });
    await reviewing;
    expect((await host.get(run.id)).answer).toBeUndefined();
    const calls = provider.calls.length;
    await host.cancel(run.id);
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("canceled");
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect(provider.calls).toHaveLength(calls);
    expect(
      (await host.events(run.id)).every((event) => !event.run.answer),
    ).toBe(true);
  } finally {
    await host.close();
    provider.stop();
  }
});
