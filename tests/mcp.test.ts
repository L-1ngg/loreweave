import { expect, test } from "bun:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AccessService } from "../src/access.ts";
import { SourceService } from "../src/sources.ts";
import { EvidenceService } from "../src/evidence.ts";
import { KnowledgeHost } from "../src/host.ts";
import { PostgresConversations } from "../src/conversations.ts";
import { ControlledEmbeddings } from "../src/development/embeddings.ts";
import { FixtureSources } from "../src/development/sources.ts";
import { startScriptedProvider } from "../src/development/provider.ts";
import { createApp } from "../src/http.ts";
import { ExternalKnowledge } from "../src/external-knowledge.ts";
const database = process.env.TEST_DATABASE_URL;
if (!database) throw new Error("TEST_DATABASE_URL required");
async function fixture(
  options: {
    beforeRelease?: () => Promise<void>;
    acquireDelayMs?: number;
    beforeAuthenticate?: () => Promise<void>;
    timing?: import("../src/host.ts").HostOptions["timing"];
  } = {},
) {
  class DelayedAccess extends AccessService {
    override async externalIdentity(token: string) {
      await options.beforeAuthenticate?.();
      return super.externalIdentity(token);
    }
  }
  const access = new DelayedAccess(database!);
  await access.migrate();
  const account = {
    organization: `mcp-${crypto.randomUUID()}`,
    username: "admin",
    password: "mcp-test-password",
  };
  await access.bootstrap(account);
  const login = await access.login(account);
  const sources = new SourceService(
    database!,
    access,
    new ControlledEmbeddings(),
  );
  class DelayedRelease extends PostgresConversations {
    override async acquire(id: string, runId?: string) {
      const writer = await super.acquire(id, runId);
      if (!writer) return writer;
      if (options.acquireDelayMs) await Bun.sleep(options.acquireDelayMs);
      return {
        ...writer,
        release: async () => {
          await options.beforeRelease?.();
          await writer.release();
        },
      };
    }
  }
  const conversations = new DelayedRelease(database!);
  const provider = startScriptedProvider();
  const evidence = new EvidenceService(sources);
  const fixtureSources = new FixtureSources();
  const host = new KnowledgeHost({
    access,
    imports: sources,
    sources: fixtureSources,
    conversations,
    providerUrl: provider.url,
    evidence,
    ...(options.timing ? { timing: options.timing } : {}),
  });
  const external = new ExternalKnowledge(access, sources, evidence, host);
  const app = createApp(host, fixtureSources, {
    access,
    imports: sources,
    external,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  const clients: Client[] = [];
  return {
    access,
    sources,
    host,
    app,
    token: login.token,
    actor: login.actor,
    async connect(token: string) {
      const client = new Client({
        name: "loreweave-integration",
        version: "1",
      });
      clients.push(client);
      await client.connect(
        // SDK 1.30 declares sessionId as string | undefined while Transport's
        // optional property excludes explicit undefined under this repo's strict mode.
        new StreamableHTTPClientTransport(new URL("mcp", server.url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }) as Transport,
      );
      return client;
    },
    async source(
      text: string,
      projectId?: string,
      prior?: { documentId: string; versionId: string },
    ) {
      const operation = await sources.submit(login.token, {
        key: crypto.randomUUID(),
        filename: "manual.md",
        bytes: Buffer.from(text),
        ...(projectId ? { projectId } : {}),
        ...(prior
          ? { documentId: prior.documentId, expectedPrior: prior.versionId }
          : {}),
      });
      while (
        (await sources.inspect(login.token, operation.id)).source ===
        "processing"
      )
        await sources.workOne();
      return operation;
    },
    async close() {
      for (const client of clients) await client.close();
      await host.close();
      server.stop(true);
      provider.stop();
      await conversations.close();
      await sources.close();
      await access.close();
    },
  };
}

test("real MCP evidence and answer tools share browser scope, citations and current-source validity", async () => {
  const f = await fixture();
  try {
    const a = await f.access.createProject(f.token, "生产项目");
    const b = await f.access.createProject(f.token, "隔离项目");
    const shared = await f.source("共享手册：日志必须加密存储。");
    const original = await f.source("生产日志保留 30 天。", a.id);
    const other = await f.source("隔离日志保留 999 天。", b.id);
    const credential = await f.access.issueCredential(f.token, {
      name: "external-reader",
      grants: ["read"],
    });
    const client = await f.connect(credential.token);
    expect(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ).toEqual(["evidence_search", "question_answer"]);
    const search = await client.callTool({
      name: "evidence_search",
      arguments: { question: "日志保留", projectId: a.id },
    });
    expect(search.isError).not.toBe(true);
    const data = search.structuredContent as {
      schemaVersion: number;
      items: Array<{
        version: string;
        citation: string;
        applicability: { projectId: string | null };
      }>;
      gaps: string[];
    };
    expect(data.schemaVersion).toBe(1);
    expect(data.items.map((item) => item.version)).toContain(
      original.versionId,
    );
    expect(data.items.map((item) => item.version)).toContain(shared.versionId);
    expect(data.items.map((item) => item.version)).not.toContain(
      other.versionId,
    );
    expect(
      data.items.find((item) => item.version === original.versionId)
        ?.applicability.projectId,
    ).toBe(a.id);
    const answer = await client.callTool({
      name: "question_answer",
      arguments: { question: "生产日志保留多久？", projectId: a.id },
    });
    expect(answer.isError).not.toBe(true);
    const result = answer.structuredContent as {
      run: {
        conversationId: string;
        answer: { citations: Array<{ version: string }> };
      };
    };
    expect(result.run.answer.citations.map((item) => item.version)).toContain(
      original.versionId,
    );
    const browser = await f.host.start({
      credential: f.token,
      question: "生产日志保留多久？",
      projectId: a.id,
    });
    await f.host.settled(browser.id);
    expect(
      (await f.host.get(browser.id, f.token)).answer?.citations.map(
        (item) => item.version,
      ),
    ).toEqual(result.run.answer.citations.map((item) => item.version));
    expect(result.run.conversationId).not.toBe(browser.conversationId);
    const updated = await f.source("生产日志保留 60 天。", a.id, original);
    const refreshed = (
      await client.callTool({
        name: "evidence_search",
        arguments: { question: "日志保留", projectId: a.id },
      })
    ).structuredContent as typeof data;
    expect(refreshed.items.map((item) => item.version)).toContain(
      updated.versionId,
    );
    expect(refreshed.items.map((item) => item.version)).not.toContain(
      original.versionId,
    );
    const historical = await f.sources.version(f.token, original.versionId);
    expect(historical.text).toContain("30");
    expect(
      data.items.find((item) => item.version === original.versionId)?.citation,
    ).toContain(original.versionId);
    const historicResource = await client.readResource({
      uri: data.items.find((item) => item.version === original.versionId)!
        .citation,
    });
    const historic = historicResource.contents[0];
    if (!historic || !("text" in historic))
      throw new Error("expected original text resource");
    expect(historic.text).toContain("30");
    expect(historic.text).toContain("superseded");
    const newAnswer = (
      await client.callTool({
        name: "question_answer",
        arguments: { question: "生产日志保留多久？", projectId: a.id },
      })
    ).structuredContent as typeof result;
    expect(
      newAnswer.run.answer.citations.map((item) => item.version),
    ).toContain(updated.versionId);
    expect(
      newAnswer.run.answer.citations.map((item) => item.version),
    ).not.toContain(original.versionId);
  } finally {
    await f.close();
  }
}, 30000);

test("external credentials reject writes, forged context and revocation on the same MCP client", async () => {
  const f = await fixture();
  try {
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    const client = await f.connect(key.token);
    const unauthorized = await client.callTool({
      name: "import_markdown",
      arguments: {},
    });
    expect(unauthorized.isError).toBe(true);
    const forged = await client.callTool({
      name: "question_answer",
      arguments: {
        question: "日志",
        conversationId: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
      },
    });
    expect(forged.isError).toBe(true);
    await expect(
      f.sources.submit(key.token, {
        key: crypto.randomUUID(),
        filename: "forged.md",
        bytes: Buffer.from("forged"),
      }),
    ).rejects.toThrow("unauthorized");
    await f.access.revokeCredential(f.token, key.id);
    await expect(
      client.callTool({
        name: "evidence_search",
        arguments: { question: "日志" },
      }),
    ).rejects.toThrow();
    expect(await f.sources.list(f.token)).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);

test("MCP authenticates separate organization credentials and rejects browser tokens", async () => {
  const f = await fixture();
  try {
    await f.source("仅组织一知道日志保留 30 天。");
    const account = {
      organization: `mcp-other-${crypto.randomUUID()}`,
      username: "other",
      password: "other-test-password",
    };
    await f.access.bootstrap(account);
    const other = await f.access.login(account);
    const key = await f.access.issueCredential(other.token, {
      name: "reader",
      grants: ["read"],
    });
    const client = await f.connect(key.token);
    const result = await client.callTool({
      name: "evidence_search",
      arguments: { question: "日志保留" },
    });
    const data = result.structuredContent as {
      items: unknown[];
      gaps: string[];
    };
    expect(data.items).toEqual([]);
    expect(data.gaps).toContain("insufficient_evidence");
    const privateProject = await f.access.createProject(f.token, "private");
    expect(
      (
        await client.callTool({
          name: "evidence_search",
          arguments: { question: "日志", projectId: privateProject.id },
        })
      ).isError,
    ).toBe(true);
    await expect(f.connect(f.token)).rejects.toThrow();
  } finally {
    await f.close();
  }
}, 30000);

test("administrator HTTP issues only read credentials and revokes them without exposing another organization", async () => {
  const f = await fixture();
  try {
    const headers = {
      cookie: `loreweave_session=${f.token}`,
      "content-type": "application/json",
    };
    const denied = await f.app.request("/api/admin/credentials", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "writer", grants: ["read", "import"] }),
    });
    expect(denied.status).toBe(400);
    const accepted = await f.app.request("/api/admin/credentials", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "reader", grants: ["read"] }),
    });
    expect(accepted.status).toBe(201);
    const key = (await accepted.json()) as {
      token: string;
      id: string;
      expiresAt: string;
    };
    const client = await f.connect(key.token);
    expect((await client.listTools()).tools).toHaveLength(2);
    const deniedAdmin = await f.app.request("/api/admin/credentials", {
      method: "POST",
      headers: { ...headers, cookie: `loreweave_session=${key.token}` },
      body: JSON.stringify({ name: "escalate", grants: ["read"] }),
    });
    expect(deniedAdmin.status).toBe(401);
    expect(
      (
        await f.app.request(`/api/admin/credentials/${key.id}/revoke`, {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(200);
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await f.close();
  }
}, 30000);

test("MCP resources map storage errors to safe public reasons", async () => {
  const f = await fixture();
  try {
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    const client = await f.connect(key.token);
    await expect(
      client.readResource({ uri: "loreweave://source/not-a-uuid#invalid" }),
    ).rejects.toThrow("invalid_input");
    // Real closed database pool forces the storage adapter's error through transport.
    await f.sources.close();
    await expect(
      client.readResource({
        uri: `loreweave://source/${crypto.randomUUID()}#${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("unavailable");
  } finally {
    await f.close();
  }
}, 30000);

test("MCP publishes its durable user result while execution cleanup still holds the writer", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({ beforeRelease: () => gate });
  try {
    await f.source("生产日志保留 30 天。");
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    const client = await f.connect(key.token);
    const response = await client.callTool(
      {
        name: "question_answer",
        arguments: { question: "生产日志保留多久？" },
      },
      undefined,
      { timeout: 2000 },
    );
    expect(response.isError).not.toBe(true);
    const data = response.structuredContent as {
      run: { id: string; status: string; settledAt?: string };
    };
    expect(data.run.status).toBe("answered");
    let settled = false;
    const settlement = f.host.settled(data.run.id).then(() => {
      settled = true;
    });
    await Bun.sleep(20);
    expect(settled).toBe(false);
    release();
    await settlement;
  } finally {
    release();
    await f.close();
  }
}, 30000);

test("MCP preserves timed-out user outcome while cleanup is still settling", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({
    beforeRelease: () => gate,
    acquireDelayMs: 100,
    timing: { ordinaryMs: 50, ordinaryReserveMs: 5 },
  });
  try {
    await f.source("生产日志保留 30 天。");
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    const client = await f.connect(key.token);
    const response = await client.callTool(
      {
        name: "question_answer",
        arguments: { question: "生产日志保留多久？" },
      },
      undefined,
      { timeout: 2000 },
    );
    const data = response.structuredContent as {
      run: { status: string; reason: string };
    };
    expect(data.run.status).toBe("timed_out");
    expect(data.run.reason).toBe("budget_exhausted");
  } finally {
    release();
    await f.close();
  }
}, 30000);

test("MCP authentication stall ends at admission deadline before any tool starts", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({ beforeAuthenticate: () => gate });
  try {
    const key = await f.access.issueCredential(f.token, {
      name: "reader",
      grants: ["read"],
    });
    const started = Date.now();
    await expect(f.connect(key.token)).rejects.toThrow("budget_exhausted");
    expect(Date.now() - started).toBeLessThan(33000);
    expect(await f.sources.list(f.token)).toHaveLength(0);
  } finally {
    release();
    await f.close();
  }
}, 35000);
