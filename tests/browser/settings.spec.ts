import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { startProbeProvider } from "../support/provider";
import { captureModel, modelAdapter } from "../../src/server/models";
import { chat } from "@tanstack/ai";
import { z } from "zod";

test("settings persist sealed revisions and dispatch through the maintained adapter", async ({
  page,
}) => {
  const provider = startProbeProvider("controlled-settings-key");
  try {
    await page.goto("/login");
    await page
      .getByLabel("访问密码")
      .fill(process.env.LOREWEAVE_ACCESS_PASSWORD!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "对话", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "添加连接" }).click();
    await page.getByLabel("连接名称").fill("Controlled compatible");
    await page.getByLabel("Base URL").fill(provider.url);
    await page
      .getByLabel("API Key", { exact: true })
      .fill("controlled-settings-key");
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(
      page.getByText("Controlled compatible", { exact: true }).first(),
    ).toBeVisible();
    await page.getByLabel("index model").fill("index-fixture");
    await page
      .getByLabel("index connection")
      .selectOption({ label: "Controlled compatible" });
    await page.getByRole("button", { name: "保存索引模型" }).click();
    await page.getByLabel("qa model").fill("qa-fixture");
    await page
      .getByLabel("qa connection")
      .selectOption({ label: "Controlled compatible" });
    await page.getByRole("button", { name: "保存问答模型" }).click();
    await page.getByRole("button", { name: "验证索引模型" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "工具、流式和结构化输出验证通过",
    );
    expect(provider.requests).toHaveLength(3);
    expect(
      provider.requests.every(
        (r) => r.authorized && r.model === "index-fixture",
      ),
    ).toBe(true);
    expect(provider.requests.some((r) => r.structured)).toBe(true);
    const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
    try {
      const [owner] = await sql`select id from owners`;
      const captured = await captureModel(
        { ownerId: owner.id, channel: "web" },
        "index",
      );
      await page
        .getByRole("button", { name: "编辑 Controlled compatible" })
        .click();
      await page
        .getByLabel("API Key", { exact: true })
        .fill("replacement-settings-key");
      await page.getByRole("button", { name: "保存连接" }).click();
      await expect(page.getByLabel("API Key", { exact: true })).toHaveCount(0);
      const newCaptured = await captureModel(
        { ownerId: owner.id, channel: "web" },
        "index",
      );
      expect(newCaptured.revisionId).not.toBe(captured.revisionId);
      const result = await chat({
        adapter: await modelAdapter(captured),
        messages: [{ role: "user", content: "Return value 42" }],
        outputSchema: z.object({ value: z.literal(42) }),
        debug: false,
      });
      expect(result.value).toBe(42);
      expect(provider.requests.at(-1)?.authorized).toBe(true);
      provider.setExpectedKey("replacement-settings-key");
      await chat({
        adapter: await modelAdapter(newCaptured),
        messages: [{ role: "user", content: "Return value 42" }],
        outputSchema: z.object({ value: z.literal(42) }),
        debug: false,
      });
      expect(provider.requests.at(-1)?.authorized).toBe(true);
      const revisions = await sql`select sealed_key from connection_revisions`;
      expect(revisions.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(revisions)).not.toContain(
        "controlled-settings-key",
      );
      expect(JSON.stringify(revisions)).not.toContain(
        "replacement-settings-key",
      );
      await page.reload();
      await expect(page.getByLabel("index model")).toHaveValue("index-fixture");
      await expect(page.getByLabel("qa model")).toHaveValue("qa-fixture");
      const html = await page.content();
      expect(html).not.toContain("controlled-settings-key");
      expect(html).not.toContain("replacement-settings-key");
      expect(html).not.toContain("sealed_key");
    } finally {
      await sql.end();
    }
  } finally {
    provider.server.stop(true);
  }
});
