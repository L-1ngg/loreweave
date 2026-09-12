import { expect, test } from "bun:test";
import { KnowledgeHost } from "../src/host.ts";
import { createApp } from "../src/http.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";

test("HTTP returns ordered provisional events and a distinct final cited result", async () => {
  const provider = startScriptedProvider();
  const sources = new FixtureSources();
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  const app = createApp(host, sources);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  try {
    const response = await fetch(new URL("api/runs", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "日志保留多久？" }),
    });
    expect(response.status).toBe(202);
    const run = (await response.json()) as { id: string };
    const stream = await fetch(
      new URL(`api/runs/${run.id}/events`, server.url),
    );
    const text = await stream.text();
    expect(text).toContain("event: progress");
    expect(text).toContain("event: result");
    expect(text).toContain("30 天");
    expect(text).toContain("event: settled");
    expect(provider.calls).toHaveLength(4);
  } finally {
    await host.close();
    server.stop(true);
    provider.stop();
  }
});

test("the configured local browser origin can use the API while unrelated origins cannot", async () => {
  const provider = startScriptedProvider();
  const sources = new FixtureSources();
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  const app = createApp(host, sources, {
    browserOrigin: "http://127.0.0.1:41735",
  });
  try {
    const request = (origin: string) =>
      app.request("http://127.0.0.1:41736/api/runs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ question: "test" }),
      });
    expect((await request("http://127.0.0.1:41735")).status).toBe(202);
    expect((await request("https://unrelated.example")).status).toBe(403);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("malformed Wiki JSON is a client error and never reaches a knowledge operation", async () => {
  let operations = 0;
  const wiki = new Proxy({} as import("../src/wiki.ts").WikiService, {
    get() {
      return async () => {
        operations++;
        throw new Error("operation_must_not_start");
      };
    },
  });
  const sources = new FixtureSources();
  const host = new KnowledgeHost({
    providerUrl: "http://127.0.0.1:1",
    sources,
  });
  const app = createApp(host, sources, { wiki });
  const id = crypto.randomUUID();
  try {
    for (const path of [
      "/wiki-restructures",
      `/wiki-edit-sets/${id}/restore`,
      `/wiki/${id}/restore`,
      "/wiki-contributions",
      `/wiki-operations/${id}/repair`,
    ]) {
      const response = await app.request(`http://localhost/api${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"key":',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(operations).toBe(0);
  } finally {
    await host.close();
  }
});

test("run HTTP rejects malformed or forged inputs before starting a turn", async () => {
  const provider = startScriptedProvider();
  const sources = new FixtureSources();
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  const app = createApp(host, sources);
  try {
    for (const body of [
      "{",
      "null",
      "[]",
      JSON.stringify({ question: " " }),
      JSON.stringify({ question: "test", credential: "forged" }),
      JSON.stringify({ question: "test", complex: "true" }),
      JSON.stringify({ question: "test", pageVersion: crypto.randomUUID() }),
      JSON.stringify({ question: "test", attachmentIds: ["invalid"] }),
    ]) {
      const response = await app.request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(provider.calls).toHaveLength(0);
    const missing = await app.request(
      `http://localhost/api/runs/${crypto.randomUUID()}`,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  } finally {
    await host.close();
    provider.stop();
  }
});

test("SSE reconnection resumes after the acknowledged event without starting another turn", async () => {
  const provider = startScriptedProvider();
  const sources = new FixtureSources();
  const host = new KnowledgeHost({ providerUrl: provider.url, sources });
  const app = createApp(host, sources);
  try {
    const run = await host.start({ question: "日志保留多久？" });
    await host.settled(run.id);
    const events = await host.events(run.id);
    const after = events[1]!.sequence;
    const response = await app.request(
      `http://localhost/api/runs/${run.id}/events`,
      {
        headers: { "last-event-id": String(after) },
      },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    const ids = [...body.matchAll(/^id: (\d+)$/gm)].map((match) =>
      Number(match[1]),
    );
    expect(ids).toEqual(
      events
        .filter((event) => event.sequence > after)
        .map((event) => event.sequence),
    );
    expect(body).toContain("event: settled");
    expect(provider.calls).toHaveLength(4);
    const invalid = await app.request(
      `http://localhost/api/runs/${run.id}/events`,
      {
        headers: { "last-event-id": "-1" },
      },
    );
    expect(invalid.status).toBe(400);
  } finally {
    await host.close();
    provider.stop();
  }
});

test("a domain parsing failure remains a server error rather than a malformed request", async () => {
  const wiki = new Proxy({} as import("../src/wiki.ts").WikiService, {
    get() {
      return async () => {
        throw new SyntaxError("private storage detail");
      };
    },
  });
  const sources = new FixtureSources();
  const host = new KnowledgeHost({
    providerUrl: "http://127.0.0.1:1",
    sources,
  });
  const app = createApp(host, sources, { wiki });
  try {
    const response = await app.request(
      "http://localhost/api/wiki-contributions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "test",
          kind: "fact",
          text: "日志保留 30 天。",
        }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  } finally {
    await host.close();
  }
});
