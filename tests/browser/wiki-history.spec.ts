import { test, expect } from "@playwright/test";

test("a member splits a topic, follows historical citations and restores the related edit set", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("组织")
    .fill(process.env.LOREWEAVE_BROWSER_ORGANIZATION!);
  await page.getByLabel("用户名", { exact: true }).fill("browser-admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("问题")).toBeVisible();
  const project = (
    await (
      await page.request.post("/api/admin/projects", {
        data: { name: `历史恢复-${crypto.randomUUID()}` },
      })
    ).json()
  ).project;
  const upload = await page.request.post("/api/attachments", {
    multipart: {
      projectId: project.id,
      file: {
        name: "完整运维手册.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# 运维总览\n\n生产日志保留 30 天。\n\n数据库备份每天执行一次。",
        ),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const imported = await page.request.post("/api/imports", {
    data: {
      attachmentId: (await upload.json()).id,
      projectId: project.id,
      key: crypto.randomUUID(),
    },
  });
  expect(imported.status()).toBe(202);
  const operation = await imported.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/imports/${operation.id}`)).json())
          .wiki,
      { timeout: 20000 },
    )
    .toBe("ready");
  const pages = (
    await (await page.request.get(`/api/wiki?projectId=${project.id}`)).json()
  ).items;
  const topic = pages.find(
    (item: { title: string }) => item.title === "运维规则",
  );
  expect(topic).toBeTruthy();
  await page.goto(`/wiki/${topic.id}`);
  await page.locator("summary").filter({ hasText: "按独立主题拆分" }).click();
  await page.getByLabel("拆分说明").fill("把日志期限和备份频率分别整理。");
  await page
    .getByRole("button", { name: "按独立主题拆分", exact: true })
    .click();
  await expect(page).toHaveURL(/wiki-operations/);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/wiki/${topic.id}`)).json())
          .lifecycle,
      { timeout: 15000 },
    )
    .toBe("split_entry");
  await page.goto(`/wiki/${topic.id}`);
  await expect(
    page.getByRole("heading", { name: "此主题已拆分" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "日志保留", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "备份规则", exact: true }),
  ).toBeVisible();
  const oldLink = page.getByRole("link", { name: /历史版本/ }).first();
  await oldLink.click();
  await expect(page.getByRole("article")).toContainText("30 天");
  await page.getByRole("link", { name: /原文 1：/ }).click();
  await expect(page.getByRole("article")).toContainText(
    "数据库备份每天执行一次",
  );
  await page.goto(`/wiki/${topic.id}`);
  await page.locator("summary").filter({ hasText: "撤回这组调整" }).click();
  await page.getByLabel("撤回理由").fill("保留统一运维流程入口。");
  await page.getByRole("button", { name: "撤回这组调整", exact: true }).click();
  await expect(page).toHaveURL(/wiki-operations/);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/wiki/${topic.id}`)).json())
          .lifecycle,
      { timeout: 15000 },
    )
    .toBe("active");
  await page.goto(`/wiki/${topic.id}`);
  await expect(page.getByRole("heading", { name: "页面历史" })).toBeVisible();
  await expect(
    page.getByText("保留统一运维流程入口。", { exact: true }),
  ).toBeVisible();
});
