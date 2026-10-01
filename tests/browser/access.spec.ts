import { test, expect } from "@playwright/test";
import postgres from "postgres";

test("login cannot submit password through a native GET before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:41739/login");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel("访问密码")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`owner access and working navigation ${viewport.width}`, async ({
    page,
    browser,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    let protectedUrl = "";
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (response) => {
      if (
        response.url().includes("/_serverFn/") &&
        response.request().method() === "GET"
      ) {
        try {
          if ((await response.text()).includes("connections"))
            protectedUrl = response.url();
        } catch {}
      }
    });
    await page.goto("/settings");
    await expect(page.getByLabel("访问密码")).toBeVisible();
    await page.getByLabel("访问密码").fill("incorrect-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("访问密码不正确");
    await page
      .getByLabel("访问密码")
      .fill(process.env.LOREWEAVE_ACCESS_PASSWORD!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "设置", exact: true }),
    ).toBeVisible();
    await expect.poll(() => protectedUrl).not.toBe("");
    const anonymous = await browser.newContext();
    const response = await anonymous.request.get(protectedUrl, {
      headers: { "x-tsr-serverfn": "true" },
    });
    expect(await response.text()).not.toContain("ownerId");
    await anonymous.close();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "设置", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "文档库", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "文档库", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "对话", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "对话", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "loreweave_session")?.httpOnly).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/access-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByLabel("访问密码")).toBeVisible();
    await page.goto("/documents");
    await expect(page.getByLabel("访问密码")).toBeVisible();
    expect(errors).toEqual([]);
    const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
    try {
      const owners = await sql`select * from owners`;
      expect(owners).toHaveLength(1);
    } finally {
      await sql.end();
    }
  });
}
