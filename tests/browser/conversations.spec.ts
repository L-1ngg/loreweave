import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
test("conversation identity, rename, deliberate resend and Stop-before-delete across desktop/mobile", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const doc = await uploadFixture(page),
      other = await rpc(page.request, "newConversation");
    await page.goto("/conversation");
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(page.getByLabel("问题")).toBeVisible();
    const id = new URL(page.url()).searchParams.get("id")!;
    await page.getByRole("button", { name: "重命名对话" }).click();
    await page
      .getByLabel("对话名称", { exact: true })
      .fill("Revenue investigation");
    await page.getByRole("button", { name: "保存对话名称" }).click();
    await expect(
      page.getByRole("heading", { name: "Revenue investigation" }),
    ).toBeVisible();
    await page.reload();
    expect(new URL(page.url()).searchParams.get("id")).toBe(id);
    provider.setQAProfile("invalid_citation");
    await page.locator(".scope-picker summary").click();
    await page
      .getByRole("checkbox", { name: "single-column", exact: true })
      .check();
    await page.getByLabel("问题").fill("Revenue?");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("生成失败");
    const [first] =
      await sql`select * from knowledge_runs where conversation_id=${id} order by created_at desc limit 1`;
    const calls = provider.requests.length;
    await page.reload();
    await expect(page.getByRole("button", { name: "重新发送" })).toBeVisible();
    expect(provider.requests.length).toBe(calls);
    provider.setQAProfile("answer");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "重新发送" }).click();
    await expect(page.getByRole("status")).toHaveText("已完成");
    const rs =
      await sql`select * from knowledge_runs where conversation_id=${id} order by created_at`;
    expect(rs).toHaveLength(2);
    expect(rs[1].id).not.toBe(first.id);
    expect(rs[1].question).toBe(first.question);
    expect(rs[0].status).toBe("failed");
    await page.reload();
    await expect(page.locator(`[data-run-id="${first.id}"]`)).toContainText(
      "生成失败",
    );
    await expect(page.locator(`[data-run-id="${rs[1].id}"]`)).toContainText(
      "已完成",
    );
    const [thread] =
      await sql`select messages from chat_threads where thread_id=${id}`;
    expect(thread.messages.filter((m: any) => m.role === "user")).toHaveLength(
      2,
    );
    provider.setDelay(10000);
    const active = await rpc(page.request, "askQuestion", {
      conversationId: id,
      submissionId: crypto.randomUUID(),
      question: "More?",
    });
    await expect(rpc(page.request, "removeChat", { id })).rejects.toThrow(
      "conversation_busy",
    );
    await page.reload();
    await page.getByRole("button", { name: "删除对话", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认删除" })).toBeDisabled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已停止");
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("id"))
      .toBeNull();
    await expect(
      rpc(page.request, "getConversation", { id }, "GET"),
    ).rejects.toThrow("conversation_not_found");
    expect(
      (await rpc(page.request, "getConversations", undefined, "GET")).some(
        (c: any) => c.id === other.id,
      ),
    ).toBe(true);
    expect(
      (await rpc(page.request, "getDocument", { id: doc.documentId }, "GET"))
        .ready,
    ).toBe(true);
    expect(
      (
        await page.request.get(
          `/api/document-versions/${doc.versionId}/original`,
        )
      ).status(),
    ).toBe(200);
    provider.setDelay(60);
    const race = await rpc(page.request, "newConversation");
    const result = await Promise.allSettled([
      rpc(page.request, "askQuestion", {
        conversationId: race.id,
        submissionId: crypto.randomUUID(),
        question: "Race?",
        scope: { mode: "selected", documentIds: [doc.documentId] },
      }),
      rpc(page.request, "removeChat", { id: race.id }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    if (result[0].status === "fulfilled") {
      await rpc(page.request, "stopQuestion", { id: result[0].value.runId });
      await rpc(page.request, "removeChat", { id: race.id });
    }
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});
