import { expect, test } from "@playwright/test";
test("Start renders and hydrates the baseline", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/baseline-probe");
  await expect(page.getByRole("heading", { name: "LoreWeave" })).toBeVisible();
  await expect(page.getByTestId("baseline")).toHaveText("Bun");
  expect(errors).toEqual([]);
});
