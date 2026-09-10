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
