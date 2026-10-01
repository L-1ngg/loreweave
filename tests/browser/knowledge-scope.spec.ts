import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";
import {
  acceptQuestion,
  createConversation,
  dispatchQuestion,
  inspectRun,
} from "../../src/server/knowledge";

test("current library discovery, mixed 20/21-page scope and canonical follow-up evidence", async ({
  page,
}) => {
  test.setTimeout(90000);
  await loginPage(page);
  const { provider, actor } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const short = await uploadFixture(page, "boundary-20.pdf");
    const long = await uploadFixture(page, "no-toc.pdf");
    const ask = async (c: string, question: string, scope?: unknown) => {
      const accepted = await rpc(page.request, "askQuestion", {
        conversationId: c,
        submissionId: crypto.randomUUID(),
        question,
        ...(scope ? { scope } : {}),
      });
      await expect
        .poll(
          async () =>
            (
              await sql`select status from knowledge_runs where id=${accepted.runId}`
            )[0].status,
          { timeout: 15000 },
        )
        .toBe("completed");
      return await rpc(page.request, "getRun", { id: accepted.runId }, "GET");
    };
    const c = await rpc(page.request, "newConversation");
    const first = await ask(c.id, "Compare Acme 2026 revenue and scope", {
      mode: "selected",
      documentIds: [short.documentId, long.documentId],
    });
    expect(first.references).toHaveLength(2);
    expect(Object.keys(first.pins)).toHaveLength(2);
    expect(first.pins[short.documentId].pageCount).toBe(20);
    expect(first.pins[long.documentId].pageCount).toBe(21);
    const [thread] =
      await sql`select messages from chat_threads where thread_id=${c.id}`;
    const structures = thread.messages
      .filter((m: any) => m.role === "tool")
      .map((m: any) => {
        try {
          return JSON.parse(m.content);
        } catch {
          return {};
        }
      })
      .filter((v: any) => v.nodes);
    expect(structures.map((v: any) => v.documentId)).toEqual([long.documentId]);
    // A deliberately unsupported prior statement cannot serve as evidence.
    const last = thread.messages.findLast((m: any) => m.role === "assistant");
    last.content = "Unsupported prior assertion: revenue was 999 million.";
    await sql`update chat_threads set messages=${sql.json(thread.messages)} where thread_id=${c.id}`;
    const second = await ask(c.id, "What about its scope?");
    expect(second.scope).toEqual(first.scope);
    expect(second.references).toHaveLength(2);
    expect(
      second.references.every(
        (r: any) => !first.references.some((old: any) => old.id === r.id),
      ),
    ).toBe(true);
    expect(
      provider.requests
        .filter((r) => r.model === "qa-fixture")
        .some((r) =>
          r.history?.some((m) =>
            JSON.stringify(m.content).includes("999 million"),
          ),
        ),
    ).toBe(true);
    expect(second.result.text).toContain("domestic operations only");
    const snap = await rpc(
      page.request,
      "getConversation",
      { id: c.id },
      "GET",
    );
    expect(snap.scope).toEqual(first.scope);
    await page.goto(`/conversation?id=${c.id}`);
    await page.reload();
    await expect(page.locator(".scope-picker summary")).toContainText(
      "2 份文档",
    );
    expect(
      await rpc(
        page.request,
        "readOriginalPages",
        { documentId: short.documentId, pages: [2] },
        "GET",
      ),
    ).toMatchObject({ versionId: short.versionId });
    let cursor: string | undefined;
    const found: string[] = [];
    do {
      const p = await rpc(
        page.request,
        "browseReading",
        { limit: 1, ...(cursor ? { cursor } : {}) },
        "GET",
      );
      found.push(...p.items.map((d: any) => d.id));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    expect(found).toEqual(
      expect.arrayContaining([short.documentId, long.documentId]),
    );
    expect(new Set(found).size).toBe(found.length);
    await expect(
      rpc(page.request, "askQuestion", {
        conversationId: c.id,
        submissionId: crypto.randomUUID(),
        question: "Q",
        scope: { mode: "selected", documentIds: [] },
      }),
    ).rejects.toThrow();
    await expect(
      rpc(page.request, "askQuestion", {
        conversationId: c.id,
        submissionId: crypto.randomUUID(),
        question: "Q",
        scope: { mode: "selected", documentIds: [crypto.randomUUID()] },
      }),
    ).rejects.toThrow();
    const library = await rpc(page.request, "newConversation");
    provider.setQAProfile("clarification");
    const ambiguous = await ask(library.id, "Which report's revenue?");
    expect(ambiguous.result.outcome).toBe("clarification");
    expect(ambiguous.pins).toEqual({});
    provider.setQAProfile("answer");
    const matching = await ask(library.id, "[document:boundary-20] Revenue?");
    expect(matching.result.outcome).toBe("answer");
    expect(matching.pins[short.documentId]).toBeDefined();
    expect(matching.scope).toEqual({ mode: "library" });
    provider.setQAProfile("evidence_gap");
    const gap = await ask(
      library.id,
      "[document:boundary-20] Unsupported fact?",
    );
    expect(gap.result.outcome).toBe("evidence_gap");
    const empty = await ask(library.id, "[document:does-not-exist] Revenue?");
    expect(empty.result.outcome).toBe("incomplete");
    provider.setQAProfile("answer");
    const bounded = await createConversation(actor);
    const accepted = await acceptQuestion(actor, {
      conversationId: bounded.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected", documentIds: [short.documentId] },
    });
    await sql`update knowledge_runs set model_config=jsonb_set(model_config,'{budgets,modelCalls}','1'::jsonb) where id=${accepted.runId}`;
    dispatchQuestion(accepted.runId);
    await expect
      .poll(async () => (await inspectRun(actor, accepted.runId)).status)
      .toBe("failed");
    const failure = await inspectRun(actor, accepted.runId);
    expect(failure.reason).toContain("model_call_budget_exceeded");
    expect(failure.usage.modelCalls).toBe(1);
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});
