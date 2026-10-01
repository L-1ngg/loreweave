import { test, expect } from "@playwright/test";
import { rename } from "node:fs/promises";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { originalPath } from "../../src/server/library";
import { resolveReference } from "../../src/server/reading";

test("missing originals disable historical citations without hiding history and fail new citation validation", async ({
  page,
}) => {
  await loginPage(page);
  const { provider, actor } = await seedFixtureModels();
  const doc = await uploadFixture(page);
  const c = await rpc(page.request, "newConversation");
  const question = () =>
    rpc(page.request, "askQuestion", {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected", documentIds: [doc.documentId] },
    });
  const accepted = await question();
  await expect
    .poll(
      async () =>
        (await rpc(page.request, "getRun", { id: accepted.runId }, "GET"))
          .status,
    )
    .toBe("completed");
  const before = await rpc(
    page.request,
    "getRun",
    { id: accepted.runId },
    "GET",
  );
  const path = originalPath(doc.versionId);
  try {
    await rename(path, `${path}.unavailable`);
    await expect(
      resolveReference(actor, before.references[0].id),
    ).rejects.toThrow("reference_original_unavailable");
    expect(
      (
        await page.request.get(
          `/api/document-versions/${doc.versionId}/original`,
        )
      ).status(),
    ).toBe(404);
    const snapshot = await rpc(
      page.request,
      "getConversation",
      { id: c.id },
      "GET",
    );
    expect(snapshot.transcript).toContain("120 million");
    expect(snapshot.references).toHaveLength(0);
    expect(snapshot.referenceIssues[0].reason).toBe(
      "reference_original_unavailable",
    );
    await page.goto(`/conversation?id=${c.id}`);
    await expect(page.getByRole("alert")).toContainText("原文不可用");
    await expect(page.locator('a[aria-disabled="true"]')).toBeVisible();
    expect(await page.locator("a[data-citation]").count()).toBe(0);
    const failed = await question();
    await expect
      .poll(
        async () =>
          (await rpc(page.request, "getRun", { id: failed.runId }, "GET"))
            .status,
      )
      .toBe("failed");
    expect(
      (await rpc(page.request, "getRun", { id: failed.runId }, "GET")).reason,
    ).toContain("reference_original_unavailable");
  } finally {
    await rename(`${path}.unavailable`, path);
    provider.server.stop(true);
  }
  expect(
    (await rpc(page.request, "getConversation", { id: c.id }, "GET")).references
      .length,
  ).toBeGreaterThan(0);
});
