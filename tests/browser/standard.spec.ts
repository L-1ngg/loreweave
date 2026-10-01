import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { loginPage, seedFixtureModels } from "../support/workspace";
import { evaluationOutputPath } from "../../scripts/evaluation-artifacts";
test("Standard printed TOC maps labels to verified physical originals and publishes summaries", async ({
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
          name: "toc-offset.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            await Bun.file("tests/fixtures/pdf/toc-offset.pdf").arrayBuffer(),
          ),
        },
        submissionId: crypto.randomUUID(),
        mode: "standard",
      },
    });
    expect(result.status()).toBe(202);
    const ids = await result.json();
    await expect
      .poll(async () => {
        const [op] =
          await sql`select status,reason from index_operations where id=${ids.operationId}`;
        return op.status === "failed" ? op.reason : op.status;
      })
      .toBe("ready");
    const [index] =
      await sql`select tree,provenance,mode from index_revisions where id=${ids.attemptId}`;
    expect(index.mode).toBe("standard");
    expect(
      index.tree.find((n: { title: string }) => n.title === "1 Overview").start,
    ).toBe(3);
    expect(
      index.tree.find((n: { title: string }) => n.title === "2 Results").start,
    ).toBe(5);
    expect(index.tree[0].start).toBe(1);
    expect(index.provenance.standard.path).toBe("printed-toc");
    expect(provider.requests.some((r) => r.task === "printed_toc")).toBe(true);
    expect(provider.requests.every((r) => r.model === "index-fixture")).toBe(
      true,
    );
    await page.goto(`/documents?id=${ids.documentId}`);
    await expect(page.locator(".chapter-tree")).toContainText("1 Overview");
    await page
      .locator(".chapter-tree")
      .getByRole("link")
      .filter({ hasText: "1 Overview" })
      .click();
    await expect(page.getByLabel("物理页码")).toHaveValue("3");
    provider.failOnTask("printed_toc");
    const refused = await page.request.post("/api/documents", {
      headers: { origin: "http://127.0.0.1:41739" },
      multipart: {
        file: {
          name: "toc-offset.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(
            await Bun.file("tests/fixtures/pdf/toc-offset.pdf").arrayBuffer(),
          ),
        },
        mode: "standard",
        submissionId: crypto.randomUUID(),
      },
    });
    const failure = await refused.json();
    await expect
      .poll(async () => {
        const [a] =
          await sql`select status from index_operations where id=${failure.operationId}`;
        return a.status;
      })
      .toBe("failed");
    const [failedDoc] =
      await sql`select effective_index from documents where id=${failure.documentId}`;
    expect(failedDoc.effective_index).toBeNull();
    await Bun.write(
      evaluationOutputPath("pageindex-standard-toc.json"),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          kind: "controlled protocol, not real model quality",
          index,
          requests: provider.requests,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});
test("Standard no-TOC and subdivision cover the frozen PDF families", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const manifest = await Bun.file("tests/fixtures/pdf/manifest.json").json();
    const records: unknown[] = [];
    for (const fixture of manifest.fixtures) {
      const response = await page.request.post("/api/documents", {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: fixture.file,
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file(
                `tests/fixtures/pdf/${fixture.file}`,
              ).arrayBuffer(),
            ),
          },
          submissionId: crypto.randomUUID(),
          mode: "standard",
        },
      });
      const ids = await response.json();
      await expect
        .poll(async () => {
          const [op] =
            await sql`select status from index_operations where id=${ids.operationId}`;
          return op.status;
        })
        .not.toMatch(/queued|processing/);
      const [op] =
        await sql`select status,reason from index_operations where id=${ids.operationId}`;
      const [index] =
        await sql`select tree,provenance from index_revisions where id=${ids.attemptId}`;
      if (["scanned", "encrypted", "malformed"].includes(fixture.kind)) {
        expect(op.status).not.toBe("ready");
        expect(index).toBeUndefined();
      } else {
        expect(op.status, `${fixture.file}: ${op.reason}`).toBe("ready");
        expect(index.tree.every((n: { summary?: string }) => !!n.summary)).toBe(
          true,
        );
        expect(index.provenance.standard.path).toBe(
          fixture.kind === "toc" ? "printed-toc" : "no-toc",
        );
      }
      records.push({
        file: fixture.file,
        sha256: fixture.sha256,
        ...op,
        index,
      });
    }
    expect(provider.requests.some((r) => r.task === "no_toc")).toBe(true);
    await Bun.write(
      evaluationOutputPath("pageindex-standard-indexing.json"),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          kind: "controlled protocol, not real model quality",
          records,
          requests: provider.requests,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});
