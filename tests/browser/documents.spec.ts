import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { loginPage, seedFixtureModels } from "../support/workspace";

test("public immutable PDF import/extraction includes rejected inputs and durable idempotency", async ({
  page,
  browser,
}) => {
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const manifest = await Bun.file("tests/fixtures/pdf/manifest.json").json();
    const accepted: Array<{
      operationId: string;
      documentId: string;
      versionId: string;
      fixture: string;
    }> = [];
    const finalArtifacts: unknown[] = [];
    const upload = async (file: string, submissionId = crypto.randomUUID()) => {
      const buffer = Buffer.from(
        await Bun.file(`tests/fixtures/pdf/${file}`).arrayBuffer(),
      );
      return page.request.post("/api/documents", {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: { name: file, mimeType: "application/pdf", buffer },
          mode: "flash",
          submissionId,
        },
      });
    };
    for (const fixture of manifest.fixtures) {
      const key = crypto.randomUUID();
      const response = await upload(fixture.file, key);
      expect(response.status()).toBe(202);
      const result = await response.json();
      accepted.push({ ...result, fixture: fixture.kind });
      if (fixture.kind === "single") {
        const again = await upload(fixture.file, key);
        expect(again.status()).toBe(200);
        expect((await again.json()).documentId).toBe(result.documentId);
        const different = await upload("multi-column.pdf", key);
        expect(different.status()).toBe(409);
        const deliberate = await upload(fixture.file);
        expect((await deliberate.json()).documentId).not.toBe(
          result.documentId,
        );
      }
      await expect
        .poll(async () => {
          const [op] =
            await sql`select status,stage from index_operations where id=${result.operationId}`;
          return `${op.status}:${op.stage}`;
        })
        .not.toMatch(/^(queued|processing):/);
      const [op] =
        await sql`select status,reason from index_operations where id=${result.operationId}`;
      if (["scanned", "encrypted", "malformed"].includes(fixture.kind)) {
        expect(op.status).toBe(
          fixture.kind === "malformed" ? "failed" : "unsupported",
        );
        if (fixture.kind === "encrypted")
          expect(op.reason).toBe("encrypted_pdf_unsupported");
        const [doc] =
          await sql`select effective_index from documents where id=${result.documentId}`;
        expect(doc.effective_index).toBeNull();
      } else if (fixture.kind === "flat")
        expect(op.reason).toBe("structural_extraction_inadequate");
      else {
        expect(op.status, op.reason).toBe("ready");
        const [attempt] =
          await sql`select draft_tree from indexing_attempts where operation_id=${result.operationId}`;
        expect(attempt.draft_tree.length).toBeGreaterThan(0);
        const [doc] =
          await sql`select effective_index from documents where id=${result.documentId}`;
        expect(doc.effective_index).not.toBeNull();
        const [index] =
          await sql`select tree,provenance from index_revisions where id=${doc.effective_index}`;
        const [usage] =
          await sql`select usage,manifests from indexing_attempts where operation_id=${result.operationId}`;
        expect(
          index.tree.every((n: { summary?: string }) => !!n.summary?.trim()),
        ).toBe(true);
        expect(usage.usage.modelCalls).toBeLessThanOrEqual(120);
        expect(Object.keys(usage.manifests).sort()).toEqual([
          "construction",
          "extraction",
          "optimization",
          "summaries",
        ]);
        finalArtifacts.push({
          file: fixture.file,
          tree: index.tree,
          provenance: index.provenance,
          usage: usage.usage,
        });
      }
      const original = await page.request.get(
        `/api/document-versions/${result.versionId}/original`,
      );
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(
        Buffer.from(
          await Bun.file(`tests/fixtures/pdf/${fixture.file}`).arrayBuffer(),
        ),
      );
      const head = await page.request.head(
        `/api/document-versions/${result.versionId}/original`,
      );
      expect(head.headers()["content-length"]).toBe(
        String((await original.body()).length),
      );
      const range = await page.request.get(
        `/api/document-versions/${result.versionId}/original`,
        { headers: { range: "bytes=10-49" } },
      );
      expect(range.status()).toBe(206);
      expect(await range.body()).toEqual(
        (await original.body()).subarray(10, 50),
      );
    }
    const columns = accepted.find((x) => x.fixture === "columns")!;
    expect(provider.requests.length).toBeGreaterThan(0);
    expect(provider.requests.every((r) => r.model === "index-fixture")).toBe(
      true,
    );
    expect(provider.requests.some((r) => r.task === "subdivide")).toBe(true);
    await Bun.write(
      "docs/evaluation/pageindex-flash-indexing.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          fixtureRevision: manifest.revision,
          kind: "controlled protocol, not model quality",
          artifacts: finalArtifacts,
          requests: provider.requests,
        },
        null,
        2,
      ),
    );
    const chaptered =
      accepted.find((x) => x.fixture === "bookmarks") ?? accepted[0];
    await page.goto(`/documents?id=${chaptered.documentId}`);
    await expect(page.locator(".chapter-tree li").first()).toBeVisible();
    await expect(page.locator(".document-inspection")).toContainText(
      "published",
    );
    await page.reload();
    await expect(page.locator(".chapter-tree li").first()).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(
        `/original/${columns.versionId}?page=1&returnTo=%2Fdocuments`,
      );
      const canvas = page.locator("canvas");
      await expect(canvas).toBeVisible();
      await expect
        .poll(() =>
          canvas.evaluate((element: HTMLCanvasElement) => {
            const context = element.getContext("2d");
            if (!context || !element.width) return 0;
            const data = context.getImageData(
              0,
              0,
              element.width,
              element.height,
            ).data;
            let ink = 0;
            for (let i = 0; i < data.length; i += 4)
              if (data[i] < 180 && data[i + 3] > 0) ink++;
            return ink;
          }),
        )
        .toBeGreaterThan(500);
      await page.screenshot({
        path: `test-results/original-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "文本", exact: true }).click();
      await expect(page.locator("pre")).toContainText("Left step 8");
      const text = await page.locator("pre").textContent();
      expect(text!.indexOf("Left step 8")).toBeLessThan(
        text!.indexOf("Right step 1"),
      );
      expect(text).toContain("Only audited totals apply.");
      await page.getByRole("button", { name: "返回", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "文档库", exact: true }),
      ).toBeVisible();
    }
    const cjk = accepted.find((x) => x.fixture === "cjk")!;
    await page.goto(`/original/${cjk.versionId}`);
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator("pre")).toContainText(
      "上海公司2026年收入为120万元，仅指境内业务。",
    );
    const anonymous = await browser.newContext();
    expect(
      (
        await anonymous.request.get(
          `/api/document-versions/${columns.versionId}/original`,
        )
      ).status(),
    ).toBe(401);
    await anonymous.close();
    const [pages] = await sql`select count(*)::int as n from document_pages`;
    expect(pages.n).toBeGreaterThan(80);
    await Bun.write(
      "test-results/extraction-import.json",
      JSON.stringify(
        {
          fixtures: manifest.fixtures.length,
          accepted: accepted.length,
          rejected: 3,
          originalBytes: "identical",
          ranges: "exact",
          columnsAndCjk: "passed",
          viewer: "desktop/mobile canvas and return passed",
          quality: "controlled fixtures, not real model quality",
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
