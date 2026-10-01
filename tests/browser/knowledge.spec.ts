import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import {
  acceptQuestion,
  createConversation,
  dispatchQuestion,
  inspectRun,
} from "../../src/server/knowledge";
import { readingTools, getPages, getStructure } from "../../src/server/reading";
import { database } from "../../src/server/database";
test("selected short/long originals support page citations in the AI React conversation", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    for (const file of ["single-column.pdf", "no-toc.pdf"]) {
      const uploadName = `qa-selection-${crypto.randomUUID()}-${file}`;
      const uploaded = await page.request.post("/api/documents", {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: uploadName,
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file(`tests/fixtures/pdf/${file}`).arrayBuffer(),
            ),
          },
          mode: "flash",
          submissionId: crypto.randomUUID(),
        },
      });
      const ids = await uploaded.json();
      await expect
        .poll(async () => {
          const [r] =
            await sql`select status from index_operations where id=${ids.operationId}`;
          return r.status;
        })
        .toBe("ready");
      await page.goto("/conversation");
      await page.getByRole("button", { name: "新对话", exact: true }).click();
      await expect(page.getByLabel("问题")).toBeVisible();
      await page.locator(".scope-picker summary").click();
      const selection = page.getByRole("checkbox", {
        name: uploadName.replace(/\.pdf$/, ""),
        exact: true,
      });
      const checkboxes = page.locator('.scope-picker input[type="checkbox"]');
      await expect.poll(() => checkboxes.count()).toBeGreaterThan(0);
      while (!(await selection.count())) {
        const before = await checkboxes.count();
        await page.getByRole("button", { name: "加载更多文档" }).click();
        await expect.poll(() => checkboxes.count()).toBeGreaterThan(before);
      }
      await selection.check();
      await page
        .getByLabel("问题")
        .fill("What was Acme 2026 revenue and its scope?");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("已完成", {
        timeout: 15000,
      });
      const citation = page.locator("a[data-citation]").first();
      await expect(citation).toBeVisible();
      const [run] =
        await sql`select * from knowledge_runs order by created_at desc limit 1`;
      expect(run.status, run.reason).toBe("completed");
      expect(run.pins[ids.documentId].versionId).toBe(ids.versionId);
      const refs =
        await sql`select * from source_references where run_id=${run.id}`;
      expect(refs.length).toBeGreaterThan(0);
      expect(refs[0].version_id).toBe(ids.versionId);
      expect(refs[0].physical_page).toBe(2);
      await page.setViewportSize({ width: 1440, height: 900 });
      await citation.click();
      await expect(page.locator(".adjacent-original canvas")).toBeVisible();
      await page.getByRole("button", { name: "关闭原文" }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await citation.click();
      await expect(page.getByLabel("物理页码")).toHaveValue("2");
      await page.getByRole("button", { name: "返回", exact: true }).click();
      await expect(page.locator("a[data-citation]").first()).toBeVisible();
      await page.reload();
      await expect(page.locator("a[data-citation]").first()).toBeVisible();
      await page.locator("a[data-citation]").first().scrollIntoViewIfNeeded();
      await expect(page.locator("a[data-citation]").first()).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(
      provider.requests.filter((r) => r.model === "qa-fixture").length,
    ).toBeGreaterThan(0);
    await page.screenshot({
      path: "test-results/conversation-mobile.png",
      fullPage: true,
    });
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});
test("durable acceptance, shared reading scope and invalid citations remain explicit", async ({
  page,
}) => {
  await loginPage(page);
  const { actor, provider } = await seedFixtureModels();
  const sql = database().client;
  try {
    await uploadFixture(page, "no-toc.pdf");
    const [doc] =
      await sql`select d.id,d.effective_version as version_id,s.page_count from documents d join source_versions s on s.id=d.effective_version where d.retired_at is null and s.page_count>20 limit 1`;
    const c = await createConversation(actor);
    const input = {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected" as const, documentIds: [doc.id] },
    };
    const accepted = await acceptQuestion(actor, input);
    const again = await acceptQuestion(actor, input);
    expect(again.runId).toBe(accepted.runId);
    expect(
      provider.requests.filter((r) => r.model === "qa-fixture"),
    ).toHaveLength(0);
    await expect(
      acceptQuestion(actor, { ...input, question: "Changed" }),
    ).rejects.toThrow("submission_payload_changed");
    await expect(
      acceptQuestion(actor, { ...input, submissionId: crypto.randomUUID() }),
    ).rejects.toThrow("conversation_busy");
    const ctx = {
      actor,
      scope: input.scope,
      pins: {},
      structureRead: new Set<string>(),
    };
    await expect(
      getPages(ctx, { documentId: doc.id, pages: [1] }),
    ).rejects.toThrow("structure_required_for_long_document");
    const first = await getStructure(ctx, { documentId: doc.id, limit: 1 });
    expect(first.nodes).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const content = await getPages(ctx, { documentId: doc.id, pages: [1] });
    expect(content.pages[0].text).toContain("Acme");
    await expect(
      getPages(ctx, { documentId: crypto.randomUUID(), pages: [1] }),
    ).rejects.toThrow("document_out_of_scope");
    await expect(
      getPages(ctx, { documentId: doc.id, pages: [999] }),
    ).rejects.toThrow("page_out_of_bounds");
    expect(readingTools(ctx).map((t) => t.name)).toEqual([
      "browse_documents",
      "get_document",
      "get_document_structure",
      "get_page_content",
    ]);
    provider.setQAProfile("invalid_citation");
    dispatchQuestion(accepted.runId);
    await expect
      .poll(async () => {
        const [r] =
          await sql`select status from knowledge_runs where id=${accepted.runId}`;
        return r.status;
      })
      .toBe("failed");
    const failure = await inspectRun(actor, accepted.runId);
    expect(failure.reason).toContain("reference_not_found");
    expect(failure.result).toBeNull();
    expect(failure.references.length).toBeGreaterThan(0);
    const [thread] =
      await sql`select messages from chat_threads where thread_id=${c.id}`;
    expect(
      thread.messages.filter((m: { role: string }) => m.role === "user"),
    ).toHaveLength(1);
  } finally {
    provider.server.stop(true);
  }
});
