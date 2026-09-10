import { expect, test, type Page } from "@playwright/test";

async function login(
  page: Page,
  username = "browser-admin",
  password = "browser-fixture-password",
) {
  await page.goto("/");
  await page
    .getByLabel("组织")
    .fill(process.env.LOREWEAVE_BROWSER_ORGANIZATION!);
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("问题")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await login(page);
  const upload = await page.request.post("/api/attachments", {
    multipart: {
      file: {
        name: "演示项目运维说明.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("演示项目的应用日志保留 30 天。"),
      },
    },
  });
  const attachment = (await upload.json()) as { id: string };
  const accepted = await page.request.post("/api/imports", {
    data: { attachmentId: attachment.id, key: "browser-original-logs-v1" },
  });
  expect(accepted.status()).toBe(202);
  const operation = (await accepted.json()) as { id: string };
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/imports/${operation.id}`);
      return ((await response.json()) as { source: string }).source;
    })
    .toBe("searchable");
});

test("browser question shows progress, a cited reviewed answer and the original", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("本地开发验证")).toBeVisible();
  await page.getByLabel("问题").fill("项目日志保留多久？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("回答完成");
  await expect(page.getByTestId("answer")).toContainText("30 天");
  await expect(page.getByTestId("answer")).not.toContainText("Exploration");
  await page.getByRole("link", { name: /演示项目运维说明.md ·/ }).click();
  await expect(
    page.getByRole("heading", { name: "演示项目运维说明.md" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .getByText("演示项目的应用日志保留 30 天。", { exact: true }),
  ).toBeVisible();
});

test("browser can cancel an active question", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("问题").fill("请查询日志保留规则");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("status")).toContainText("已取消");
  await expect(page.getByTestId("answer")).toHaveCount(0);
});

test("reloading reconnects to the same PostgreSQL run without submitting again", async ({
  page,
}) => {
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/runs"
    )
      submissions++;
  });
  await page.goto("/");
  await page.getByLabel("问题").fill("断线后继续查看日志规则");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page).toHaveURL(/conversation=/);
  const conversationUrl = page.url();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("回答完成");
  await expect(page.getByTestId("answer")).toContainText("30 天");
  expect(page.url()).toBe(conversationUrl);
  expect(submissions).toBe(1);
  await page.reload();
  await expect(page.getByTestId("answer")).toContainText("30 天");
  expect(submissions).toBe(1);
});

test("administrator creates a member and project, then revokes the member's active session", async ({
  page,
  browser,
}) => {
  const username = `member-${Date.now()}`;
  await page.getByText("成员与项目管理", { exact: true }).click();
  await page.getByLabel("新成员用户名").fill(username);
  await page.getByLabel("新成员密码").fill("member-fixture-password");
  await page.getByLabel("成员权限").selectOption("read");
  await page.getByRole("button", { name: "创建成员", exact: true }).click();
  await expect(page.getByTestId(`member-${username}`)).toBeVisible();
  const projectName = `项目-${Date.now()}`;
  await page.getByLabel("新项目名称").fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL!,
  });
  const member = await context.newPage();
  try {
    await login(member, username, "member-fixture-password");
    await expect(
      member.getByText("成员与项目管理", { exact: true }),
    ).toHaveCount(0);
    await member.getByLabel("知识范围").selectOption({ label: projectName });
    await member.getByLabel("问题").fill("项目相关的共享日志说明");
    await member.getByRole("button", { name: "提问", exact: true }).click();
    await expect(member.getByTestId("answer")).toContainText("30 天");
    const selected = await member.getByLabel("知识范围").inputValue();
    await member.reload();
    await expect(member.getByLabel("知识范围")).toHaveValue(selected);
    await expect(member.getByTestId("answer")).toContainText("30 天");
    await page
      .getByTestId(`member-${username}`)
      .getByRole("button", { name: "撤销登录" })
      .click();
    await member.reload();
    await expect(
      member.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Markdown upload exposes searchable original blocks without executing HTML or fetching images", async ({
  page,
}) => {
  let imageRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("example.invalid")) imageRequests++;
  });
  const original =
    "# 发布文档\r\n\r\n- 日志保留 60 天\r\n\r\n| 项目 | 周期 |\r\n| --- | --- |\r\n| API | 每日 |\r\n\r\n```ts\r\nconst id = 'SKU-004';\r\n```\r\n\r\n![拓扑][diagram]\r\n\r\n[diagram]: https://example.invalid/image.png\r\n\r\n<script>window.hacked=true</script>";
  await page.getByLabel("Markdown 文件").setInputFiles({
    name: "release.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(original),
  });
  const acceptedPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/imports") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "直接导入" }).click();
  const accepted = (await (await acceptedPromise).json()) as { id: string };
  const item = page.getByTestId(`import-${accepted.id}`);
  await expect(item).toContainText("来源可检索");
  await item.getByRole("link", { name: "查看原文" }).click();
  await expect(page.getByRole("heading", { name: "发布文档" })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("每日");
  await expect(page.locator("code")).toContainText("SKU-004");
  await expect(page.locator("article img")).toHaveCount(0);
  await expect(page.locator("article script")).toHaveCount(0);
  expect(imageRequests).toBe(0);
  await expect(page.getByRole("link", { name: "图片链接" })).toHaveAttribute(
    "href",
    "https://example.invalid/image.png",
  );
  await page.getByText("查看完整原文", { exact: true }).click();
  expect(await page.getByTestId("original-markdown").textContent()).toBe(
    original,
  );
  const download = await page.request.get(
    (await page
      .getByRole("link", { name: "下载原始 Markdown" })
      .getAttribute("href")) ?? "",
  );
  expect(await download.body()).toEqual(Buffer.from(original));
});

test("natural-language attachment import survives reload and malformed UTF-8 reports failure", async ({
  page,
}) => {
  await page.getByLabel("Markdown 文件").setInputFiles({
    name: "conversation.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 对话导入\n项目采用 GraphRAG"),
  });
  await expect(page.getByText("已附加：conversation.md")).toBeVisible();
  await page.getByLabel("问题").fill("请把附件导入知识库");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByTestId("answer")).toContainText("已受理 1 项导入");
  await page.reload();
  await expect(page.getByTestId("answer")).toContainText("已受理 1 项导入");
  await page.getByLabel("Markdown 文件").setInputFiles({
    name: "invalid.md",
    mimeType: "text/markdown",
    buffer: Buffer.from([0xff]),
  });
  const acceptedPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/imports") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "直接导入" }).click();
  const accepted = (await (await acceptedPromise).json()) as { id: string };
  await expect(page.getByTestId(`import-${accepted.id}`)).toContainText(
    "导入失败",
  );
  await expect(page.getByTestId(`import-${accepted.id}`)).toContainText(
    "invalid_encoding",
  );
});

test("unrelated questions expose an evidence gap and diagnostics instead of a definitive answer", async ({
  page,
}) => {
  await page.getByLabel("问题").fill("2025 年营收金额是多少？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("部分回答");
  await expect(page.getByTestId("answer")).toContainText("未取得足够依据");
  await page.getByText("开发诊断", { exact: true }).click();
  await expect(
    page.getByText('"embeddingRequests": 1', { exact: false }),
  ).toBeVisible();
});

test("selected source updates keep old citations readable and link the new current version", async ({
  page,
}) => {
  const uploaded = await page.request.post("/api/attachments", {
    multipart: {
      file: {
        name: "发布说明.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("发布窗口是星期一。"),
      },
    },
  });
  const accepted = await page.request.post("/api/imports", {
    data: {
      attachmentId: (await uploaded.json()).id,
      key: crypto.randomUUID(),
    },
  });
  const operation = (await accepted.json()) as {
    id: string;
    versionId: string;
  };
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/imports/${operation.id}`)).json())
          .source,
    )
    .toBe("searchable");
  await page.goto(`/sources/${operation.versionId}`);
  await expect(page.getByRole("heading", { name: "更新此文档" })).toBeVisible();
  await page.getByLabel("Markdown 文件").setInputFiles({
    name: "发布说明.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("发布窗口是星期三。"),
  });
  await page.getByRole("button", { name: "提交新版本" }).click();
  await expect(page.getByText("历史版本，当前检索使用后续版本")).toBeVisible();
  await expect(page.getByRole("article")).toContainText("星期一");
  await page.getByRole("link", { name: "查看当前版本" }).click();
  await expect(page.getByRole("article")).toContainText("星期三");
  await expect(page.getByText("当前生效来源", { exact: true })).toBeVisible();
});
