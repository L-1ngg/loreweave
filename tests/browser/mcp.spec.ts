import { test, expect } from "@playwright/test";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { mcpClient, toolValue } from "../support/mcp";

test("one-time token UI and official MCP primitives/resources/revocation", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  let clients: Array<Awaited<ReturnType<typeof mcpClient>>> = [];
  try {
    const doc = await uploadFixture(page);
    const other = await rpc(page.request, "newToken", { name: "Other client" });
    await page.goto("/settings");
    await page.getByLabel("令牌名称").fill("Desktop assistant");
    await page.getByRole("button", { name: "创建令牌" }).click();
    const token = await page.getByTestId("new-mcp-token").textContent();
    expect(token).toMatch(/^lw_/);
    const list = await rpc(page.request, "getTokens", undefined, "GET");
    expect(JSON.stringify(list)).not.toContain(token!);
    const c = await mcpClient(token!, undefined, true);
    clients.push(c);
    expect(c.transport.sessionId).toBeDefined();
    const call = async (name: string, args: unknown) =>
      toolValue(
        await c.client.callTool({
          name,
          arguments: args as Record<string, unknown>,
        }),
      );
    const names = (await c.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      "browse_documents",
      "get_document",
      "get_document_structure",
      "get_page_content",
      "question_answer",
    ]);
    const browse = await call("browse_documents", { limit: 1 });
    expect(browse.items).toHaveLength(1);
    expect(
      await call("get_document", { documentId: doc.documentId }),
    ).toMatchObject({ versionId: doc.versionId });
    const tree = await call("get_document_structure", {
      documentId: doc.documentId,
      limit: 1,
    });
    expect(tree.nodes).toHaveLength(1);
    const pages = await call("get_page_content", {
      documentId: doc.documentId,
      versionId: doc.versionId,
      pages: [2],
    });
    expect(pages.pages[0].text).toContain("120 million");
    const resource = await c.client.readResource({ uri: pages.pages[0].uri });
    expect(JSON.stringify(resource)).toContain(doc.versionId);
    expect(
      (
        await c.client.callTool({
          name: "get_page_content",
          arguments: { documentId: doc.documentId, pages: [999] },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await c.client.callTool({
          name: "get_document",
          arguments: {
            documentId: doc.documentId,
            ownerId: crypto.randomUUID(),
          },
        })
      ).isError,
    ).toBe(true);
    await expect(
      c.client.callTool({
        name: "delete_document",
        arguments: { documentId: doc.documentId },
      }),
    ).rejects.toThrow("not found");
    expect(
      provider.requests.filter((r) => r.model === "qa-fixture"),
    ).toHaveLength(0);
    await page.getByRole("button", { name: "已保存，关闭" }).click();
    await page.reload();
    expect(await page.content()).not.toContain(token!);
    await page.getByRole("button", { name: "撤销 Desktop assistant" }).click();
    await expect(
      page.locator(".connection-row").filter({ hasText: "Desktop assistant" }),
    ).toContainText("已撤销");
    await expect(
      c.client.callTool({ name: "browse_documents", arguments: {} }),
    ).rejects.toThrow();
    await expect(
      c.client.readResource(
        { uri: pages.pages[0].uri },
        { cacheMode: "refresh" },
      ),
    ).rejects.toThrow();
    const c2 = await mcpClient(other.token);
    clients.push(c2);
    expect(
      toolValue(
        await c2.client.callTool({
          name: "get_page_content",
          arguments: { documentId: doc.documentId, pages: [2] },
        }),
      ).pages[0].page,
    ).toBe(2);
    await expect(
      page.getByRole("heading", { name: "设置", exact: true }),
    ).toBeVisible();
    const denied = await fetch("http://127.0.0.1:41739/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(denied.status).toBe(401);
    expect(
      (
        await fetch(
          `http://127.0.0.1:41739/api/document-versions/${doc.versionId}/original`,
          { headers: { authorization: `Bearer ${other.token}` } },
        )
      ).status,
    ).toBe(401);
  } finally {
    for (const c of clients) await c.client.close();
    provider.server.stop(true);
  }
});

test("stored token verification and revocation survive a real application restart", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const live = await rpc(page.request, "newToken", { name: "Restart client" }),
    revoked = await rpc(page.request, "newToken", {
      name: "Revoked restart client",
    });
  await rpc(page.request, "removeToken", { id: revoked.id });
  const origin = "http://127.0.0.1:41749";
  const spawn = () =>
    Bun.spawn([process.execPath, "--no-env-file", "scripts/serve.ts"], {
      env: {
        ...process.env,
        LOREWEAVE_PORT: "41749",
        LOREWEAVE_MODE: "fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  let child: ReturnType<typeof spawn> | undefined;
  const wait = () =>
    expect
      .poll(async () => {
        try {
          return (await fetch(origin)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
  try {
    child = spawn();
    await wait();
    let c = await mcpClient(live.token, origin);
    expect((await c.client.listTools()).tools).toHaveLength(5);
    await c.client.close();
    child.kill("SIGKILL");
    await child.exited;
    child = undefined;
    child = spawn();
    await wait();
    c = await mcpClient(live.token, origin);
    expect((await c.client.listTools()).tools).toHaveLength(5);
    await c.client.close();
    await expect(mcpClient(revoked.token, origin)).rejects.toThrow();
    expect(
      JSON.stringify(await rpc(page.request, "getTokens", undefined, "GET")),
    ).not.toContain(live.token);
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
    }
  }
});
