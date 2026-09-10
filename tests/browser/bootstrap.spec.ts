import { expect, test, type Page } from "@playwright/test";

async function login(
  page: Page,
  username = "browser-admin",
  password = "browser-fixture-password",
) {
  await page.goto("/");
  await page.getByLabel("组织").fill("browser-test");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("问题")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await login(page);
});

test("browser question shows progress, a cited reviewed answer and the original", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("本地演示资料")).toBeVisible();
  await page.getByLabel("问题").fill("项目日志保留多久？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("回答完成");
  await expect(page.getByTestId("answer")).toContainText("30 天");
  await expect(page.getByTestId("answer")).not.toContainText("Exploration");
  await page.getByRole("link", { name: "演示项目运维说明 · v1" }).click();
  await expect(
    page.getByRole("heading", { name: "演示项目运维说明" }),
  ).toBeVisible();
  await expect(
    page.getByText("演示项目的应用日志保留 30 天。", { exact: true }),
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
