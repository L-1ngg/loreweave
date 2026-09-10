import { expect, test } from "bun:test";
import { AccessService } from "../src/access.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");

test("an administrator creates a member who signs in with revocable operation grants", async () => {
  const access = new AccessService(url);
  await access.migrate();
  const organization = `org-${crypto.randomUUID()}`;
  try {
    await access.bootstrap({
      organization,
      username: "admin",
      password: "admin-test-password",
    });
    const admin = await access.login({
      organization,
      username: "admin",
      password: "admin-test-password",
    });
    const member = await access.createMember(admin.token, {
      username: "reader",
      password: "reader-test-password",
      grants: ["read"],
    });
    const login = await access.login({
      organization,
      username: "reader",
      password: "reader-test-password",
    });
    const context = await access.authorize(login.token, "read");
    expect(context.actorId).toBe(member.id);
    expect(context.organizationId).toBe(admin.actor.organizationId);
    expect(context.scope.includeShared).toBe(true);
    await expect(access.authorize(login.token, "import")).rejects.toThrow(
      "unauthorized",
    );
    await access.revoke(login.token);
    await expect(access.authorize(login.token, "read")).rejects.toThrow(
      "unauthorized",
    );
    await expect(
      access.login({
        organization,
        username: "reader",
        password: "wrong-password",
      }),
    ).rejects.toThrow("unauthorized");
  } finally {
    await access.close();
  }
});

test("project scope includes shared knowledge, rejects other organizations, and credentials can be revoked", async () => {
  const access = new AccessService(url);
  await access.migrate();
  try {
    const organization = `scope-${crypto.randomUUID()}`;
    await access.bootstrap({
      organization,
      username: "admin",
      password: "admin-test-password",
    });
    const admin = await access.login({
      organization,
      username: "admin",
      password: "admin-test-password",
    });
    const project = await access.createProject(admin.token, "企业项目");
    const member = await access.createMember(admin.token, {
      username: "member",
      password: "member-test-password",
      grants: ["read", "import"],
    });
    const login = await access.login({
      organization,
      username: "member",
      password: "member-test-password",
    });
    expect(
      (await access.authorize(login.token, "read", project.id)).scope,
    ).toEqual({ projectId: project.id, includeShared: true });
    expect(
      (await access.projects(login.token)).map((item) => item.id),
    ).toContain(project.id);
    const foreign = `foreign-${crypto.randomUUID()}`;
    await access.bootstrap({
      organization: foreign,
      username: "admin",
      password: "admin-test-password",
    });
    const outsider = await access.login({
      organization: foreign,
      username: "admin",
      password: "admin-test-password",
    });
    await expect(
      access.authorize(outsider.token, "read", project.id),
    ).rejects.toThrow("unauthorized");
    await access.revokeMemberSessions(admin.token, member.id);
    await expect(access.authorize(login.token, "import")).rejects.toThrow(
      "unauthorized",
    );
    await expect(
      access.createMember(outsider.token, {
        username: "bad space",
        password: "long-enough-password",
        grants: ["read"],
      }),
    ).rejects.toThrow("invalid_input");
  } finally {
    await access.close();
  }
});

test("authenticated HTTP creates a scoped conversation and rejects revoked or foreign credentials", async () => {
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const { createApp } = await import("../src/http.ts");
  const access = new AccessService(url);
  await access.migrate();
  const organization = `http-${crypto.randomUUID()}`;
  await access.bootstrap({
    organization,
    username: "admin",
    password: "admin-test-password",
  });
  const store = new PostgresConversations(url);
  const sources = new FixtureSources({
    organizationId: await access.organization(organization),
  });
  const provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations: store,
    access,
  });
  const app = createApp(host, sources, { access });
  try {
    expect(
      (
        await app.request("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: "未登录" }),
        })
      ).status,
    ).toBe(401);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization,
        username: "admin",
        password: "admin-test-password",
      }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const response = await app.request("/api/runs", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ question: "共享资料的日志规则" }),
    });
    expect(response.status).toBe(202);
    const run = (await response.json()) as { id: string };
    await host.settled(run.id);
    expect(
      (await app.request(`/api/runs/${run.id}`, { headers: { cookie } }))
        .status,
    ).toBe(200);
    const foreign = `outside-${crypto.randomUUID()}`;
    await access.bootstrap({
      organization: foreign,
      username: "admin",
      password: "admin-test-password",
    });
    const outsider = await access.login({
      organization: foreign,
      username: "admin",
      password: "admin-test-password",
    });
    expect(
      (
        await app.request(`/api/runs/${run.id}`, {
          headers: { cookie: `loreweave_session=${outsider.token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/auth/logout", {
          method: "POST",
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/runs/${run.id}`, { headers: { cookie } }))
        .status,
    ).toBe(401);
  } finally {
    await host.close();
    provider.stop();
    await store.close();
    await access.close();
  }
});

test("model-supplied identity cannot replace trusted tool scope and revocation blocks the next operation", async () => {
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const access = new AccessService(url);
  await access.migrate();
  const organization = `tool-${crypto.randomUUID()}`;
  await access.bootstrap({
    organization,
    username: "admin",
    password: "admin-test-password",
  });
  const login = await access.login({
    organization,
    username: "admin",
    password: "admin-test-password",
  });
  const store = new PostgresConversations(url);
  const sources = new FixtureSources({
    organizationId: login.actor.organizationId,
  });
  const forged = startScriptedProvider({
    toolArguments: { actorId: "attacker", organizationId: "foreign" },
  });
  const host = new KnowledgeHost({
    providerUrl: forged.url,
    sources,
    conversations: store,
    access,
  });
  try {
    const run = await host.start({
      question: "伪造身份",
      credential: login.token,
    });
    await host.settled(run.id);
    const result = await host.get(run.id, login.token);
    expect(result.status).toBe("failed");
    expect(result.counts.retrieval).toBe(0);
    expect(result.answer).toBeUndefined();
  } finally {
    await host.close();
    forged.stop();
  }
  let revoked: Promise<void> | undefined;
  const provider = startScriptedProvider({
    delayMs: 100,
    onRequest(phase) {
      if (phase === "task") revoked = access.revoke(login.token);
    },
  });
  const revokedHost = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations: store,
    access,
  });
  try {
    const run = await revokedHost.start({
      question: "请求中撤销授权",
      credential: login.token,
    });
    await revokedHost.settled(run.id);
    await revoked;
    expect(provider.calls).toHaveLength(1);
    expect((await store.run(run.id)).answer).toBeUndefined();
    await expect(
      revokedHost.start({ question: "再次请求", credential: login.token }),
    ).rejects.toThrow("unauthorized");
  } finally {
    await revokedHost.close();
    provider.stop();
    await store.close();
    await access.close();
  }
});

test("project classification filters retrieval without hiding historical sources from organization members", async () => {
  const { PostgresConversations } = await import("../src/conversations.ts");
  const { KnowledgeHost } = await import("../src/host.ts");
  const { FixtureSources } = await import("../src/development/sources.ts");
  const { startScriptedProvider } =
    await import("../src/development/provider.ts");
  const { createApp } = await import("../src/http.ts");
  const access = new AccessService(url);
  await access.migrate();
  const organization = `scope-read-${crypto.randomUUID()}`;
  await access.bootstrap({
    organization,
    username: "admin",
    password: "admin-test-password",
  });
  const login = await access.login({
    organization,
    username: "admin",
    password: "admin-test-password",
  });
  const a = await access.createProject(login.token, "A"),
    b = await access.createProject(login.token, "B");
  const sources = new FixtureSources({
    organizationId: login.actor.organizationId,
    projectId: b.id,
  });
  const store = new PostgresConversations(url),
    provider = startScriptedProvider();
  const host = new KnowledgeHost({
    providerUrl: provider.url,
    sources,
    conversations: store,
    access,
  });
  const app = createApp(host, sources, { access });
  try {
    const outside = await host.start({
      question: "查询项目A",
      credential: login.token,
      projectId: a.id,
    });
    await host.settled(outside.id);
    expect((await host.get(outside.id, login.token)).answer).toBeUndefined();
    const history = await app.request("/api/sources/v1", {
      headers: { cookie: `loreweave_session=${login.token}` },
    });
    expect(history.status).toBe(200);
    const inside = await host.start({
      question: "查询项目B",
      credential: login.token,
      projectId: b.id,
    });
    await host.settled(inside.id);
    expect((await host.get(inside.id, login.token)).status).toBe("answered");
    expect((await host.get(inside.id, login.token)).scope).toEqual({
      projectId: b.id,
      includeShared: true,
    });
  } finally {
    await host.close();
    provider.stop();
    await store.close();
    await access.close();
  }
});
