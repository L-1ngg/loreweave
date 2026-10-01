import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { loginPage, seedFixtureModels } from "../support/workspace";

test("leaving indexing and explicit Flash-to-Standard retry preserve operation identity", async ({
  page,
}) => {
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const result = await page.request.post("/api/documents", {
      headers: { origin: "http://127.0.0.1:41739" },
      multipart: {
        file: {
          name: "inadequate.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            await Bun.file("tests/fixtures/pdf/inadequate.pdf").arrayBuffer(),
          ),
        },
        mode: "flash",
        submissionId: crypto.randomUUID(),
      },
    });
    const ids = await result.json();
    await page.goto("/settings");
    await expect
      .poll(async () => {
        const [a] =
          await sql`select status from index_operations where id=${ids.operationId}`;
        return a.status;
      })
      .toBe("failed");
    expect(provider.requests).toHaveLength(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/documents?id=${ids.documentId}`);
      await expect(page.getByRole("alert")).toContainText(
        "structural_extraction_inadequate",
      );
    }
    await page.getByLabel("重试索引模式").selectOption("standard");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.goto("/conversation");
    await expect
      .poll(async () => {
        const [a] =
          await sql`select status from index_operations where id=${ids.operationId}`;
        return a.status;
      })
      .toBe("ready");
    const [op] =
      await sql`select * from index_operations where id=${ids.operationId}`;
    expect(op.version_id).toBe(ids.versionId);
    expect(op.document_id).toBe(ids.documentId);
    expect(op.latest_attempt).not.toBe(ids.attemptId);
    const [index] =
      await sql`select provenance,mode from index_revisions where id=${op.latest_attempt}`;
    expect(index.mode).toBe("standard");
    expect(index.provenance.reusedExtraction).toBe(true);
    await page.goto(`/documents?id=${ids.documentId}`);
    await expect(page.locator(".document-inspection")).toContainText("可问答");
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});

test("real process crash interrupts queued/running work and never replays provider calls", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  const url = "http://127.0.0.1:41749";
  const spawn = () =>
    Bun.spawn([process.execPath, "--no-env-file", "scripts/serve.ts"], {
      env: {
        ...process.env,
        LOREWEAVE_PORT: "41749",
        LOREWEAVE_MODE: "fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  let child: ReturnType<typeof spawn> | undefined;
  const context = await browser.newContext({ baseURL: url });
  const childPage = await context.newPage();
  try {
    child = spawn();
    await expect
      .poll(async () => {
        try {
          return (await fetch(url)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await loginPage(childPage);
    provider.setDelay(10000);
    const accepted = await childPage.request.post("/api/documents", {
      headers: { origin: url },
      multipart: {
        file: {
          name: "no-toc.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            await Bun.file("tests/fixtures/pdf/no-toc.pdf").arrayBuffer(),
          ),
        },
        mode: "flash",
        submissionId: crypto.randomUUID(),
      },
    });
    const ids = await accepted.json();
    await expect.poll(() => provider.requests.length).toBeGreaterThan(0);
    child.kill("SIGKILL");
    await child.exited;
    child = undefined;
    const calls = provider.requests.length;
    child = spawn();
    await expect
      .poll(async () => {
        try {
          return (await fetch(url)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
    const [a] =
      await sql`select status,reason from indexing_attempts where id=${ids.attemptId}`;
    expect(a.status).toBe("interrupted");
    expect(a.reason).toBe("application_restarted");
    await childPage.goto(`/documents?id=${ids.documentId}`);
    await childPage.reload();
    await expect(childPage.locator(".document-inspection")).toContainText(
      "已中断",
    );
    expect(provider.requests.length).toBe(calls);
    provider.setDelay(60);
    await childPage.getByRole("button", { name: "重试", exact: true }).click();
    await expect
      .poll(async () => {
        const [op] =
          await sql`select status from index_operations where id=${ids.operationId}`;
        return op.status;
      })
      .toBe("ready");
    const [op] =
      await sql`select latest_attempt,version_id from index_operations where id=${ids.operationId}`;
    expect(op.version_id).toBe(ids.versionId);
    expect(op.latest_attempt).not.toBe(ids.attemptId);
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
    }
    await context.close();
    await sql.end();
    provider.server.stop(true);
  }
});
