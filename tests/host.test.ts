import { expect, test } from "bun:test";
import { KnowledgeHost } from "../src/host.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";

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

test("the original deadline covers the Agent loop and never delivers incomplete streamed output", async () => {
  const provider = startScriptedProvider({ delayMs: 300 });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
    timing: { ordinaryMs: 100 },
  });
  try {
    const run = await host.start({ question: "慢查询" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("timed_out");
    expect(result.answer).toBeUndefined();
    expect(result.settledAt).toBeDefined();
    expect(result.counts.generation).toBe(0);
    expect(result.counts.review).toBe(0);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("a source change while the Agent answers cannot finalize stale citations", async () => {
  const sources = new FixtureSources();
  let requests = 0;
  const provider = startScriptedProvider({
    onRequest(phase) {
      if (phase === "task" && ++requests === 2)
        sources.replace("日志改为保留 60 天。");
    },
  });
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  try {
    const run = await host.start({ question: "日志规则" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("source_changed");
    expect(result.answer).toBeUndefined();
    expect(
      (await host.events(run.id)).every((event) => !event.run.answer),
    ).toBe(true);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("invalid issued-handle references are rejected without a model reviewer", async () => {
  const provider = startScriptedProvider({
    answer: {
      basis: "source",
      text: "日志保留 30 天 [e999]",
      citations: ["e999"],
      gaps: [],
      conflicts: [],
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志规则" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.reason).toBe("invalid_citation");
    expect(result.answer).toBeUndefined();
    expect(provider.calls.every((call) => call.phase === "task")).toBe(true);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("actual gaps and conflicts produce an explicit partial direct answer", async () => {
  const provider = startScriptedProvider({
    answer: {
      basis: "source",
      text: "日志保留 30 天 [e1]",
      citations: ["e1"],
      gaps: ["备份保留时间未找到依据。"],
      conflicts: ["两份制度的适用日期尚不明确。"],
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志和备份规则" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("partial");
    expect(result.answer?.text).toContain("备份保留时间未找到依据");
    expect(result.answer?.text).toContain("适用日期尚不明确");
  } finally {
    await host.close();
    provider.stop();
  }
});

test("repeated tool work stays within the original Agent and retrieval ceilings", async () => {
  const provider = startScriptedProvider({ repeatTool: true });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "继续检查" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.answer).toBeUndefined();
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("model_call_budget_exhausted");
    expect(result.counts).toEqual({
      exploration: 4,
      retrieval: 2,
      generation: 0,
      review: 0,
    });
    expect(provider.calls).toHaveLength(4);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("canceling the final Agent request waits for settlement without delivering provisional text", async () => {
  let entered!: () => void;
  const answering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let count = 0;
  const provider = startScriptedProvider({
    delayMs: 100,
    onRequest() {
      if (++count === 2) entered();
    },
  });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志规则" });
    await answering;
    expect((await host.get(run.id)).answer).toBeUndefined();
    await host.cancel(run.id);
    await host.settled(run.id);
    expect((await host.get(run.id)).status).toBe("canceled");
    expect((await host.get(run.id)).answer).toBeUndefined();
    expect(provider.calls).toHaveLength(2);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("provider execution failure is not reported as a wall-clock timeout", async () => {
  const provider = startScriptedProvider({ failTasks: 1 });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "日志规则" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("agent_execution_failed");
    expect(result.counts.exploration).toBe(1);
  } finally {
    await host.close();
    provider.stop();
  }
});
