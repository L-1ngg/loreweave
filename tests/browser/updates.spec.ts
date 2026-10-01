import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { mcpClient, toolValue } from "../support/mcp";
test("targeted updates preserve prior effective versions, pinned questions and immutable Web/MCP citations", async ({
  page,
}) => {
  test.setTimeout(90000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  let m: Awaited<ReturnType<typeof mcpClient>> | undefined;
  try {
    const doc = await uploadFixture(page),
      same = await uploadFixture(page);
    expect(same.documentId).not.toBe(doc.documentId);
    const token = await rpc(page.request, "newToken", { name: "Update reads" });
    m = await mcpClient(token.token);
    const c = await rpc(page.request, "newConversation");
    provider.setDelay(700);
    const question = await rpc(page.request, "askQuestion", {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected", documentIds: [doc.documentId] },
    });
    const update = async (
      file: string,
      mode: string,
      revision: number,
      submissionId = crypto.randomUUID(),
    ) =>
      page.request.post(`/api/documents/${doc.documentId}/updates`, {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: file,
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file(`tests/fixtures/pdf/${file}`).arrayBuffer(),
            ),
          },
          mode,
          expectedRevision: String(revision),
          submissionId,
        },
      });
    const failed = await (await update("inadequate.pdf", "flash", 1)).json();
    await expect
      .poll(
        async () =>
          (
            await sql`select status from index_operations where id=${failed.operationId}`
          )[0].status,
      )
      .toBe("failed");
    expect(
      (
        await sql`select effective_version from documents where id=${doc.documentId}`
      )[0].effective_version,
    ).toBe(doc.versionId);
    await expect
      .poll(
        async () =>
          (
            await sql`select status from knowledge_runs where id=${question.runId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("completed");
    const original = await rpc(
      page.request,
      "getRun",
      { id: question.runId },
      "GET",
    );
    expect(original.references[0].versionId).toBe(doc.versionId);
    provider.setDelay(60);
    provider.setQADelay(600);
    const pinned = await rpc(page.request, "askQuestion", {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Pinned during update?",
    });
    for (const [mode, file] of [
      ["standard", "no-toc.pdf"],
      ["flash", "toc-offset.pdf"],
    ]) {
      const details = await rpc(
        page.request,
        "getDocument",
        { id: doc.documentId },
        "GET",
      );
      const submission = crypto.randomUUID(),
        r = await update(file, mode, details.revision, submission);
      expect(r.status()).toBe(202);
      const ids = await r.json();
      expect(ids.documentId).toBe(doc.documentId);
      const duplicate = await update(file, mode, details.revision, submission);
      expect((await duplicate.json()).operationId).toBe(ids.operationId);
      await expect
        .poll(
          async () =>
            (
              await sql`select status from index_operations where id=${ids.operationId}`
            )[0].status,
          { timeout: 15000 },
        )
        .toBe("ready");
      expect(
        (
          await sql`select effective_version from documents where id=${doc.documentId}`
        )[0].effective_version,
      ).toBe(ids.versionId);
      expect((await update(file, mode, details.revision)).status()).toBe(409);
    }
    await expect
      .poll(
        async () =>
          (
            await sql`select status from knowledge_runs where id=${pinned.runId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("completed");
    expect(
      (await rpc(page.request, "getRun", { id: pinned.runId }, "GET"))
        .references[0].versionId,
    ).toBe(doc.versionId);
    provider.setQADelay();
    const current = await rpc(
      page.request,
      "getDocument",
      { id: doc.documentId },
      "GET",
    );
    expect(current.versions.length).toBe(4);
    const old = toolValue(
      await m.client.callTool({
        name: "get_page_content",
        arguments: {
          documentId: doc.documentId,
          versionId: doc.versionId,
          pages: [2],
        },
      }),
    );
    expect(old.versionId).toBe(doc.versionId);
    expect(
      JSON.stringify(await m.client.readResource({ uri: old.pages[0].uri })),
    ).toContain(doc.versionId);
    await page.goto(`/conversation?id=${c.id}`);
    await page.locator("a[data-citation]").first().click();
    await expect(page.locator(".adjacent-original canvas")).toBeVisible();
    await page.getByRole("button", { name: "关闭原文" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("a[data-citation]").first().click();
    expect(page.url()).toContain(doc.versionId);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    const next = await rpc(page.request, "askQuestion", {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Now?",
    });
    await expect
      .poll(
        async () =>
          (
            await sql`select status from knowledge_runs where id=${next.runId}`
          )[0].status,
      )
      .toBe("completed");
    expect(
      (await rpc(page.request, "getRun", { id: next.runId }, "GET")).pins[
        doc.documentId
      ].versionId,
    ).toBe(current.versionId);
    await page.goto(`/documents?id=${doc.documentId}`);
    await page
      .getByLabel("更新 PDF 文件")
      .setInputFiles("tests/fixtures/pdf/single-column.pdf");
    await page.getByLabel("更新索引模式").selectOption("standard");
    await page.getByRole("button", { name: "提交更新" }).click();
    await expect
      .poll(
        async () =>
          (
            await sql`select library_revision from documents where id=${doc.documentId}`
          )[0].library_revision,
      )
      .toBe(4);
    provider.setDelay(300);
    const a = await (await update("no-toc.pdf", "flash", 4)).json(),
      b = await (await update("toc-offset.pdf", "standard", 4)).json();
    await expect
      .poll(
        async () =>
          (
            await sql`select status from index_operations where id=${a.operationId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("failed");
    expect(
      (
        await sql`select reason from index_operations where id=${a.operationId}`
      )[0].reason,
    ).toBe("publication_conflict");
    await expect
      .poll(
        async () =>
          (
            await sql`select status from index_operations where id=${b.operationId}`
          )[0].status,
        { timeout: 15000 },
      )
      .toBe("ready");
    expect(
      (
        await sql`select effective_version from documents where id=${doc.documentId}`
      )[0].effective_version,
    ).toBe(b.versionId);
  } finally {
    await m?.client.close();
    await sql.end();
    provider.server.stop(true);
  }
});
