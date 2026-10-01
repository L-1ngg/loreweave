import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { mcpClient, toolValue } from "../support/mcp";
test("retirement excludes new Web/MCP QA and late publication while retaining authorized historical originals", async ({
  page,
}) => {
  test.setTimeout(90000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  let m: Awaited<ReturnType<typeof mcpClient>> | undefined;
  try {
    const doc = await uploadFixture(page),
      other = await uploadFixture(page, "toc-offset.pdf");
    const c = await rpc(page.request, "newConversation");
    const run = await rpc(page.request, "askQuestion", {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected", documentIds: [doc.documentId] },
    });
    await expect
      .poll(
        async () =>
          (
            await sql`select status from knowledge_runs where id=${run.runId}`
          )[0].status,
      )
      .toBe("completed");
    const token = await rpc(page.request, "newToken", {
      name: "Historical reads",
    });
    m = await mcpClient(token.token);
    provider.setDelay(300);
    const update = await (
      await page.request.post(`/api/documents/${doc.documentId}/updates`, {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: "no-toc.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file("tests/fixtures/pdf/no-toc.pdf").arrayBuffer(),
            ),
          },
          mode: "flash",
          expectedRevision: "1",
          submissionId: crypto.randomUUID(),
        },
      })
    ).json();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/documents?id=${doc.documentId}`);
    await page.getByRole("button", { name: "移出当前库", exact: true }).click();
    await page.getByRole("button", { name: "确认移出" }).click();
    await expect(page.locator(".document-inspection")).toContainText(
      "已移出当前库",
    );
    await expect
      .poll(
        async () =>
          (
            await sql`select status from index_operations where id=${update.operationId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("failed");
    expect(
      (
        await sql`select reason from index_operations where id=${update.operationId}`
      )[0].reason,
    ).toBe("publication_conflict");
    await expect(
      rpc(page.request, "retryOperation", {
        operationId: update.operationId,
        submissionId: crypto.randomUUID(),
        mode: "standard",
      }),
    ).rejects.toThrow("retry_obsolete");
    expect(
      (await rpc(page.request, "getLibrary", { limit: 50 }, "GET")).items.some(
        (d: any) => d.id === doc.documentId,
      ),
    ).toBe(false);
    await expect(
      rpc(page.request, "askQuestion", {
        conversationId: c.id,
        submissionId: crypto.randomUUID(),
        question: "Again?",
      }),
    ).rejects.toThrow("selected_document_unavailable");
    const denied = await m.client.callTool({
      name: "question_answer",
      arguments: {
        question: "Again?",
        scope: { mode: "selected", documentIds: [doc.documentId] },
      },
    });
    expect(denied.isError).toBe(true);
    const browse = toolValue(
      await m.client.callTool({
        name: "browse_documents",
        arguments: { filter: "single-column" },
      }),
    );
    expect(browse.items.some((d: any) => d.id === doc.documentId)).toBe(false);
    const historical = toolValue(
      await m.client.callTool({
        name: "get_page_content",
        arguments: {
          documentId: doc.documentId,
          versionId: doc.versionId,
          pages: [2],
        },
      }),
    );
    expect(historical.pages[0].text).toContain("120 million");
    expect(
      JSON.stringify(
        await m.client.readResource({ uri: historical.pages[0].uri }),
      ),
    ).toContain(doc.versionId);
    await page.goto(`/conversation?id=${c.id}`);
    await page.locator("a[data-citation]").click();
    expect(page.url()).toContain(doc.versionId);
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("a[data-citation]").click();
    await expect(page.locator(".adjacent-original canvas")).toBeVisible();
    await rpc(page.request, "removeToken", { id: token.id });
    await expect(
      m.client.readResource(
        { uri: historical.pages[0].uri },
        { cacheMode: "refresh" },
      ),
    ).rejects.toThrow();
    expect(
      (
        await page.request.get(
          `/api/document-versions/${doc.versionId}/original`,
        )
      ).status(),
    ).toBe(200);
    expect(
      (await rpc(page.request, "getDocument", { id: other.documentId }, "GET"))
        .ready,
    ).toBe(true);
    // Even a never-published, already accepted upload cannot resurrect after retirement.
    const fresh = await (
      await page.request.post("/api/documents", {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: "no-toc.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file("tests/fixtures/pdf/no-toc.pdf").arrayBuffer(),
            ),
          },
          submissionId: crypto.randomUUID(),
          mode: "standard",
        },
      })
    ).json();
    await rpc(page.request, "retireSource", { id: fresh.documentId });
    await expect
      .poll(
        async () =>
          (
            await sql`select status from index_operations where id=${fresh.operationId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("failed");
    expect(
      (
        await sql`select effective_version from documents where id=${fresh.documentId}`
      )[0].effective_version,
    ).toBeNull();
    const restartToken = await rpc(page.request, "newToken", {
      name: "Retired after restart",
    });
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "scripts/serve.ts"],
      {
        env: {
          ...process.env,
          LOREWEAVE_PORT: "41749",
          LOREWEAVE_MODE: "fixture",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    try {
      await expect
        .poll(async () => {
          try {
            return (await fetch("http://127.0.0.1:41749")).status;
          } catch {
            return 0;
          }
        })
        .toBe(200);
      const client = await mcpClient(
        restartToken.token,
        "http://127.0.0.1:41749",
      );
      try {
        expect(
          toolValue(
            await client.client.callTool({
              name: "get_document",
              arguments: {
                documentId: doc.documentId,
                versionId: doc.versionId,
              },
            }),
          ).retired,
        ).toBe(true);
        expect(
          toolValue(
            await client.client.callTool({
              name: "browse_documents",
              arguments: { filter: "single-column" },
            }),
          ).items.some((d: any) => d.id === doc.documentId),
        ).toBe(false);
        expect(
          JSON.stringify(
            await client.client.readResource({ uri: historical.pages[0].uri }),
          ),
        ).toContain(doc.versionId);
      } finally {
        await client.client.close();
      }
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
  } finally {
    await m?.client.close();
    await sql.end();
    provider.server.stop(true);
  }
});
