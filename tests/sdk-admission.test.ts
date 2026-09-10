import { expect, test } from "bun:test";
import { createAgent } from "@forge-agent/core/sdk";
import { startScriptedProvider } from "../src/development/provider.ts";

test("SDK requests acquire host admission before every loopback dispatch", async () => {
  const provider = startScriptedProvider({ repeatTool: true });
  let admissions = 0;
  const agent = await createAgent({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    apiKey: "fixture-only",
    baseUrl: provider.url,
    cwd: process.cwd(),
    systemPrompt: "Test knowledge tools",
    permission: {
      rules: [{ tool: "search_evidence", argsPattern: "*", effect: "allow" }],
    },
    retry: { enabled: false, maxRetries: 0 },
    context: { enabled: false },
    beforeModelRequest: () => {
      if (++admissions > 2) throw new Error("budget exhausted");
    },
    tools: [
      {
        name: "search_evidence",
        label: "Evidence",
        description: "Find evidence",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute() {
          return {
            content: [{ type: "text", text: "Original evidence" }],
            details: {},
          };
        },
      },
    ],
  });
  try {
    for await (const _event of agent.runTurn("What is the retention period?")) {
      /* consume settlement */
    }
    expect(provider.calls.filter((call) => call.phase === "task")).toHaveLength(
      2,
    );
    expect(admissions).toBe(3);
  } finally {
    await agent.dispose();
    provider.stop();
  }
});

test("SDK retries cannot dispatch beyond the same host admission counter", async () => {
  const provider = startScriptedProvider({ failTasks: 5 });
  let admissions = 0;
  const agent = await createAgent({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    apiKey: "fixture-only",
    baseUrl: provider.url,
    cwd: process.cwd(),
    systemPrompt: "Retry example",
    context: { enabled: false },
    retry: { enabled: true, maxRetries: 4, baseDelayMs: 0 },
    beforeModelRequest: () => {
      if (++admissions > 2) throw new Error("budget exhausted");
    },
  });
  try {
    for await (const _event of agent.runTurn("Question")) {
      /* consume */
    }
    expect(provider.calls).toHaveLength(2);
    expect(admissions).toBe(3);
  } finally {
    await agent.dispose();
    provider.stop();
  }
});

test("SDK summaries acquire the same admission hook before reaching the provider", async () => {
  const provider = startScriptedProvider();
  const kinds: string[] = [];
  const agent = await createAgent({
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    apiKey: "fixture-only",
    baseUrl: provider.url,
    cwd: process.cwd(),
    systemPrompt: "Summary example",
    retry: { enabled: false, maxRetries: 0 },
    context: { enabled: false, keepRecentTokens: 1 },
    beforeModelRequest: ({ kind }) => {
      kinds.push(kind);
      if (kind === "summary") throw new Error("budget exhausted");
    },
    permission: {
      rules: [{ tool: "search_evidence", argsPattern: "*", effect: "allow" }],
    },
    tools: [
      {
        name: "search_evidence",
        label: "Evidence",
        description: "Evidence",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute() {
          return { content: [{ type: "text", text: "Evidence" }], details: {} };
        },
      },
    ],
  });
  try {
    for await (const _event of agent.runTurn(
      "Longer conversation to compact",
    )) {
      /* consume */
    }
    const result = await agent.compact();
    expect(result.status).toBe("error");
    expect(kinds).toContain("summary");
    expect(
      provider.calls.filter((call) => call.phase === "summary"),
    ).toHaveLength(0);
  } finally {
    await agent.dispose();
    provider.stop();
  }
});
