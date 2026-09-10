import { expect, test } from "@playwright/test";

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
