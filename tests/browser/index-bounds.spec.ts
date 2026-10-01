import { test, expect } from "@playwright/test";
import { loginPage, seedFixtureModels } from "../support/workspace";
import {
  acceptOriginal,
  activateIndex,
  artifactDigest,
  loadExtraction,
} from "../../src/server/library";
import { dispatchIndex } from "../../src/server/indexing";
import { database } from "../../src/server/database";
import { indexingAttempts } from "../../src/server/schema";
import { eq } from "drizzle-orm";

test("failed summary, call exhaustion and incomplete manifests cannot activate an index", async ({
  page,
}) => {
  await loginPage(page);
  const { actor, provider } = await seedFixtureModels();
  const sql = database().client;
  try {
    for (const scenario of ["schema", "budget"]) {
      provider.failOnTask(scenario === "schema" ? "summarize_leaf" : undefined);
      const accepted = await acceptOriginal(actor, {
        submissionId: crypto.randomUUID(),
        filename: "no-toc.pdf",
        bytes: new Uint8Array(
          await Bun.file("tests/fixtures/pdf/no-toc.pdf").arrayBuffer(),
        ),
        mode: "flash",
      });
      const id = accepted.operation.latestAttempt;
      if (scenario === "budget") {
        const [a] = await database()
          .db.select()
          .from(indexingAttempts)
          .where(eq(indexingAttempts.id, id));
        await database()
          .db.update(indexingAttempts)
          .set({
            modelConfig: {
              ...a.modelConfig,
              budgets: { ...a.modelConfig.budgets, modelCalls: 1 },
            },
          })
          .where(eq(indexingAttempts.id, id));
      }
      dispatchIndex(id);
      await expect
        .poll(async () => {
          const [a] =
            await sql`select status from indexing_attempts where id=${id}`;
          return a.status;
        })
        .toBe("failed");
      const [a] =
        await sql`select usage,reason,stage from indexing_attempts where id=${id}`;
      expect(a.stage).toBe("summaries");
      if (scenario === "budget") {
        expect(a.usage.modelCalls).toBe(1);
        expect(a.reason).toContain("model_call_budget_exceeded");
      }
      const [doc] =
        await sql`select effective_index from documents where id=${accepted.operation.documentId}`;
      expect(doc.effective_index).toBeNull();
      const extraction = await loadExtraction(accepted.operation.versionId);
      expect(extraction).not.toBeNull();
      expect(artifactDigest(extraction)).toBe(
        artifactDigest(JSON.parse(JSON.stringify(extraction))),
      );
      await expect(activateIndex(id, [], {})).rejects.toThrow();
    }
  } finally {
    provider.server.stop(true);
  }
});
