import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { rename } from "node:fs/promises";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { mcpClient, toolValue } from "../support/mcp";
import { originalPath, hashData } from "../../src/server/library";
import type { listLibrary } from "../../src/server/library";
import type { getPages } from "../../src/server/reading";

test("bounded page continuations retain every requested page through Web and MCP", async ({
  page,
}) => {
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  let client: Awaited<ReturnType<typeof mcpClient>> | undefined;
  try {
    const doc = await uploadFixture(page);
    // Synthetic stored-page artifacts isolate the reading limit from PDF layout
    // and model behavior. The public readers still use real PostgreSQL artifacts.
    const texts = [
      "First page. ".repeat(3300),
      "Second page. ".repeat(2000),
      "Last page.",
    ];
    for (const [i, text] of texts.entries())
      await sql`update document_pages set artifact=jsonb_set(artifact, '{text}', ${sql.json(text)}) where version_id=${doc.versionId} and physical_page=${i + 1}`;
    const token = await rpc(page.request, "newToken", {
      name: "Continuation reader",
    });
    client = await mcpClient(token.token);
    for (const channel of ["web", "mcp"]) {
      const collected = new Map<number, string>();
      let next: { pages: number[]; offset: number } | null = {
        pages: [1, 2, 3],
        offset: 0,
      };
      for (let calls = 0; next && calls < 10; calls++) {
        const input = {
          documentId: doc.documentId,
          versionId: doc.versionId,
          ...next,
        };
        const value: Awaited<ReturnType<typeof getPages>> =
          channel === "web"
            ? await rpc(page.request, "readOriginalPages", input, "GET")
            : toolValue(
                await client.client.callTool({
                  name: "get_page_content",
                  arguments: input,
                }),
              );
        expect(
          value.pages.reduce(
            (n: number, p: { text: string }) => n + p.text.length,
            0,
          ),
        ).toBeLessThanOrEqual(18000);
        for (const p of value.pages) {
          expect(p.offset).toBe((collected.get(p.page) ?? "").length);
          collected.set(p.page, (collected.get(p.page) ?? "") + p.text);
        }
        next = value.next;
        expect(value.complete).toBe(next === null);
      }
      expect(next).toBeNull();
      expect([...collected.keys()]).toEqual([1, 2, 3]);
      const identity = (text: string) => ({
        length: text.length,
        digest: hashData(text),
      });
      expect([...collected.values()].map(identity)).toEqual(
        texts.map(identity),
      );
    }
  } finally {
    await client?.client.close();
    await sql.end();
    provider.server.stop(true);
  }
});

test("discovery describes the effective source when a different update fails", async ({
  page,
}) => {
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  let client: Awaited<ReturnType<typeof mcpClient>> | undefined;
  try {
    const doc = await uploadFixture(page);
    provider.failOnTask("no_toc");
    const response = await page.request.post(
      `/api/documents/${doc.documentId}/updates`,
      {
        headers: { origin: "http://127.0.0.1:41739" },
        multipart: {
          file: {
            name: "no-toc.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(
              await Bun.file("tests/fixtures/pdf/no-toc.pdf").arrayBuffer(),
            ),
          },
          mode: "standard",
          expectedRevision: "1",
          submissionId: crypto.randomUUID(),
        },
      },
    );
    expect(response.status()).toBe(202);
    const update = await response.json();
    await expect
      .poll(
        async () =>
          (
            await rpc(
              page.request,
              "getOperation",
              { id: update.operationId },
              "GET",
            )
          ).status,
      )
      .toBe("failed");
    const token = await rpc(page.request, "newToken", {
      name: "Version metadata",
    });
    client = await mcpClient(token.token);
    const expected = {
      versionId: doc.versionId,
      indexId: doc.attemptId,
      pageCount: 6,
      mode: "flash",
    };
    const findListedDocument = async (
      read: (
        cursor?: string,
      ) => Promise<Awaited<ReturnType<typeof listLibrary>>>,
    ) => {
      let cursor: string | undefined;
      do {
        const library = await read(cursor);
        const item = library.items.find((d) => d.id === doc.documentId);
        if (item) return item;
        cursor = library.nextCursor ?? undefined;
      } while (cursor);
    };
    const metadata = toolValue(
      await client.client.callTool({
        name: "get_document",
        arguments: { documentId: doc.documentId },
      }),
    );
    expect(metadata).toMatchObject(expected);
    for (const fn of ["getLibrary", "browseReading"]) {
      expect(
        await findListedDocument((cursor) =>
          rpc(page.request, fn, { limit: 50, cursor }, "GET"),
        ),
      ).toMatchObject({
        ...expected,
        ready: true,
        status: "failed",
        latestVersion: update.versionId,
      });
    }
    expect(
      await findListedDocument(async (cursor) =>
        toolValue(
          await client!.client.callTool({
            name: "browse_documents",
            arguments: { limit: 50, cursor },
          }),
        ),
      ),
    ).toMatchObject(expected);
  } finally {
    await client?.client.close();
    provider.server.stop(true);
  }
});

test("stored text remains readable after PDF loading fails", async ({
  page,
}) => {
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  let path: string | undefined;
  try {
    const doc = await uploadFixture(page);
    path = originalPath(doc.versionId);
    await rename(path, `${path}.unavailable`);
    await page.goto(`/original/${doc.versionId}?page=2`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.locator(".original-text")).toContainText("120 million");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "下一页", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.locator(".original-text small")).toContainText(
      "物理页 3",
    );
    await sql`delete from document_pages where version_id=${doc.versionId} and physical_page=3`;
    await page.reload();
    await page.getByRole("button", { name: "文本", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("page_unavailable");
  } finally {
    if (path) await rename(`${path}.unavailable`, path);
    await sql.end();
    provider.server.stop(true);
  }
});
