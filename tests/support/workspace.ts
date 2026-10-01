import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import postgres from "postgres";
import { saveConnection, saveRole } from "../../src/server/models";
import { startProbeProvider } from "./provider";

export async function loginPage(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("访问密码")
    .fill(process.env.LOREWEAVE_ACCESS_PASSWORD!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "对话", exact: true }),
  ).toBeVisible();
}
export async function seedFixtureModels() {
  const provider = startProbeProvider("product-fixture-key");
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  const [owner] = await sql`select id from owners`;
  await sql.end();
  const actor = { ownerId: String(owner.id), channel: "web" as const };
  const connection = await saveConnection(actor, {
    name: "Product fixture",
    provider: "openai-compatible",
    baseURL: provider.url,
    apiKey: "product-fixture-key",
  });
  for (const role of ["index", "qa"] as const)
    await saveRole(actor, {
      role,
      connectionId: connection.id,
      model: `${role}-fixture`,
    });
  return { provider, actor };
}
export async function uploadFixture(
  page: Page,
  file = "single-column.pdf",
  mode = "flash",
) {
  const response = await page.request.post("/api/documents", {
    headers: { origin: new URL(page.url()).origin },
    multipart: {
      file: {
        name: file,
        mimeType: "application/pdf",
        buffer: Buffer.from(
          await Bun.file(`tests/fixtures/pdf/${file}`).arrayBuffer(),
        ),
      },
      mode,
      submissionId: crypto.randomUUID(),
    },
  });
  expect(response.status()).toBe(202);
  const ids = await response.json();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    await expect
      .poll(async () => {
        const [r] =
          await sql`select status,reason from index_operations where id=${ids.operationId}`;
        return r.status === "failed" ? r.reason : r.status;
      })
      .toBe("ready");
  } finally {
    await sql.end();
  }
  return ids as {
    documentId: string;
    versionId: string;
    attemptId: string;
    operationId: string;
  };
}
