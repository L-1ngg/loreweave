import { expect, test } from "bun:test";
import { KnowledgeHost } from "../src/host.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";

test("AC01: general knowledge finalizes the Agent answer without retrieval or review", async () => {
  const provider = startScriptedProvider({ noRetrieval: true });
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "标准大气压下水的沸点？" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("answered");
    expect(result.answer?.text).toContain("通识回答，未查询知识库");
    expect(result.answer?.text).toContain("100°C");
    expect(result.answer?.citations).toEqual([]);
    expect(result.answer?.certificate).toBeUndefined();
    expect(result.counts).toEqual({
      exploration: 1,
      retrieval: 0,
      generation: 0,
      review: 0,
    });
    expect(provider.calls.map((call) => call.phase)).toEqual(["task"]);
    expect(
      (await host.events(run.id))
        .filter((event) => event.run.answer)
        .every((event) => event.run.answer?.text === result.answer?.text),
    ).toBe(true);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("AC02: original evidence grounds the Agent's own answer without finalization model calls", async () => {
  const provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources: new FixtureSources(),
  });
  try {
    const run = await host.start({ question: "项目日志保留多久？" });
    await host.settled(run.id);
    const result = await host.get(run.id);
    expect(result.status).toBe("answered");
    expect(result.answer?.text).toContain("30 天");
    expect(result.answer?.citations[0]?.version).toBe("v1");
    expect(result.answer?.certificate).toBeUndefined();
    expect(provider.calls.map((call) => call.phase)).toEqual(["task", "task"]);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("direct answer formatting tolerates literal newlines but never guesses malformed quotes or unknown handles", async () => {
  const { parseDirectAnswer } = await import("../src/direct-answer.ts");
  const raw =
    '{"basis":"source","text":"first\nsecond","citations":["e1"],"gaps":[],"conflicts":[]}';
  expect(parseDirectAnswer(raw).text).toBe("first\nsecond\n\n来源：[e1]");
  expect(() =>
    parseDirectAnswer(
      '{"basis":"mixed","text":"quoted "fact"","citations":[],"gaps":[],"conflicts":[]}',
    ),
  ).toThrow("invalid_draft");
  const provider = startScriptedProvider({
    answer: {
      basis: "source",
      text: "unsupported handle",
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
    const run = await host.start({ question: "项目日志" });
    await host.settled(run.id);
    expect((await host.get(run.id)).reason).toBe("invalid_citation");
    expect((await host.get(run.id)).answer).toBeUndefined();
  } finally {
    await host.close();
    provider.stop();
  }
});
