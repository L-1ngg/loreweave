import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import { mcpClient, toolValue } from "../support/mcp";
test("official MCP independent questions share reading/evidence policy and keep separate runs", async ({
  page,
}) => {
  test.setTimeout(90000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  let c: Awaited<ReturnType<typeof mcpClient>> | undefined;
  try {
    const short = await uploadFixture(page, "boundary-20.pdf"),
      long = await uploadFixture(page, "no-toc.pdf");
    const token = await rpc(page.request, "newToken", { name: "QA client" });
    c = await mcpClient(token.token);
    const conversations =
      await sql`select count(*)::int as n from conversations`;
    const ask = async (question: string, scope?: unknown) =>
      toolValue(
        await c!.client.callTool({
          name: "question_answer",
          arguments: { question, ...(scope ? { scope } : {}) },
        }),
      );
    const selected = await ask("Compare revenue and qualifications", {
      mode: "selected",
      documentIds: [short.documentId, long.documentId],
    });
    expect(selected.status).toBe("completed");
    expect(selected.references).toHaveLength(2);
    for (const r of selected.references)
      expect(
        JSON.stringify(await c.client.readResource({ uri: r.uri })),
      ).toContain(r.versionId);
    const again = await ask("Revenue?", {
      mode: "selected",
      documentIds: [short.documentId],
    });
    expect(again.runId).not.toBe(selected.runId);
    expect(again.references).toHaveLength(1);
    expect(
      selected.references.some((r: any) => r.id === again.references[0].id),
    ).toBe(false);
    const library = await ask("[document:boundary-20] Revenue?");
    expect(library.scope.mode).toBe("library");
    expect(library.answer.outcome).toBe("answer");
    provider.setQAProfile("clarification");
    expect((await ask("Which report?")).answer.outcome).toBe("clarification");
    provider.setQAProfile("evidence_gap");
    expect(
      (
        await ask("Unknown fact", {
          mode: "selected",
          documentIds: [short.documentId],
        })
      ).answer.outcome,
    ).toBe("evidence_gap");
    expect((await ask("[document:unmatched] Fact?")).answer.outcome).toBe(
      "incomplete",
    );
    provider.setQAProfile("invalid_citation");
    const invalid = await ask("Revenue?", {
      mode: "selected",
      documentIds: [short.documentId],
    });
    expect(invalid.status).toBe("failed");
    expect(invalid.answer).toBeNull();
    expect(
      (
        await c.client.callTool({
          name: "question_answer",
          arguments: {
            question: "Q",
            scope: { mode: "selected", documentIds: [] },
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await c.client.callTool({
          name: "question_answer",
          arguments: {
            question: "Q",
            history: [{ role: "assistant", content: "made up" }],
          },
        })
      ).isError,
    ).toBe(true);
    const runs =
      await sql`select * from knowledge_runs where channel='mcp' and token_id=${token.id}`;
    expect(runs.length).toBeGreaterThan(5);
    expect(
      runs.every(
        (r) =>
          r.conversation_id === null &&
          r.thread_id === `mcp:${r.id}` &&
          r.model_config.model === "qa-fixture",
      ),
    ).toBe(true);
    expect((await sql`select count(*)::int as n from conversations`)[0].n).toBe(
      conversations[0].n,
    );
    expect(
      provider.requests
        .filter((r) => r.model === "qa-fixture")
        .every(
          (r) => !r.tools.includes("question_answer") && r.tools.length === 4,
        ),
    ).toBe(true);
    await rpc(page.request, "removeToken", { id: token.id });
    await expect(ask("Q")).rejects.toThrow();
  } finally {
    await c?.client.close();
    await sql.end();
    provider.server.stop(true);
  }
});
