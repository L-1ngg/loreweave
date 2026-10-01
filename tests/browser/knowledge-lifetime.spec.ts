import { test, expect } from "@playwright/test";
import postgres from "postgres";
import {
  loginPage,
  seedFixtureModels,
  uploadFixture,
} from "../support/workspace";
import { rpc } from "../support/rpc";

test("reload, navigation and closure observe the same producer; Stop cancels real provider work", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  try {
    const doc = await uploadFixture(page);
    const c = await rpc(page.request, "newConversation");
    provider.setDelay(600);
    const input = {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue and scope?",
      scope: { mode: "selected", documentIds: [doc.documentId] },
    };
    const accepted = await rpc(page.request, "askQuestion", input);
    const get = async () =>
      (await sql`select * from knowledge_runs where id=${accepted.runId}`)[0];
    await page.goto(`/conversation?id=${c.id}`);
    await expect(page.getByLabel("问题")).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.close();
    await expect
      .poll(async () => (await get()).status, { timeout: 15000 })
      .toBe("completed");
    const count = provider.requests.filter(
      (r) => r.model === "qa-fixture",
    ).length;
    const again = await context.newPage();
    await again.setViewportSize({ width: 390, height: 844 });
    await again.goto(`/conversation?id=${c.id}`);
    await expect(again.locator("a[data-citation]")).toBeVisible();
    await again.reload();
    await expect(again.locator("a[data-citation]")).toBeVisible();
    const ids = await again
      .locator("[data-message-id]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("data-message-id")));
    expect(new Set(ids).size).toBe(ids.length);
    expect(await rpc(again.request, "askQuestion", input)).toMatchObject({
      runId: accepted.runId,
      created: false,
    });
    expect(
      provider.requests.filter((r) => r.model === "qa-fixture"),
    ).toHaveLength(count);
    expect((await get()).usage.modelCalls).toBe(count);
    expect(
      (
        await context.request.get(`/api/runs/${crypto.randomUUID()}/events`)
      ).status(),
    ).toBe(404);
    const anonymous = await fetch(
      `http://127.0.0.1:41739/api/runs/${accepted.runId}/events`,
    );
    expect(anonymous.status).toBe(401);
    await expect(
      rpc(again.request, "getConversation", { id: crypto.randomUUID() }, "GET"),
    ).rejects.toThrow();
    provider.setDelay(10000);
    await again.getByLabel("问题").fill("Explain again");
    await again.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(
        () => provider.requests.filter((r) => r.model === "qa-fixture").length,
      )
      .toBeGreaterThan(count);
    await again.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(again.getByRole("status")).toContainText("已停止");
    await expect.poll(() => provider.aborted).toBeGreaterThan(0);
    const [stopped] =
      await sql`select * from knowledge_runs where conversation_id=${c.id} order by created_at desc limit 1`;
    expect(stopped.status).toBe("stopped");
    expect(stopped.result).toBeNull();
    const [conversation] =
      await sql`select active_run from conversations where id=${c.id}`;
    expect(conversation.active_run).toBeNull();
    expect(
      await rpc(again.request, "stopQuestion", { id: stopped.id }),
    ).toMatchObject({ status: "stopped" });
    await again.close();
  } finally {
    await sql.end();
    provider.server.stop(true);
  }
});

test("process loss restores interrupted questions and completed-log fallback without execution replay", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  await loginPage(page);
  const { provider } = await seedFixtureModels();
  const doc = await uploadFixture(page);
  const sql = postgres(process.env.LOREWEAVE_DATABASE_URL!, { max: 1 });
  const origin = "http://127.0.0.1:41749";
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
  const ctx = await browser.newContext({ baseURL: origin });
  const p = await ctx.newPage();
  const wait = () =>
    expect
      .poll(async () => {
        try {
          return (await fetch(origin)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
  try {
    child = spawn();
    await wait();
    await loginPage(p);
    const c = await rpc(
      p.request,
      "newConversation",
      undefined,
      "POST",
      origin,
    );
    await rpc(
      p.request,
      "renameChat",
      { id: c.id, name: "Restart history" },
      "POST",
      origin,
    );
    const input = {
      conversationId: c.id,
      submissionId: crypto.randomUUID(),
      question: "Revenue?",
      scope: { mode: "selected", documentIds: [doc.documentId] },
    };
    const done = await rpc(p.request, "askQuestion", input, "POST", origin);
    await expect
      .poll(
        async () =>
          (
            await sql`select status from knowledge_runs where id=${done.runId}`
          )[0].status,
      )
      .toBe("completed");
    const initialCalls = provider.requests.filter(
      (r) => r.model === "qa-fixture",
    ).length;
    provider.setDelay(10000);
    const active = await rpc(
      p.request,
      "askQuestion",
      { ...input, submissionId: crypto.randomUUID(), question: "Follow up" },
      "POST",
      origin,
    );
    await expect
      .poll(
        () => provider.requests.filter((r) => r.model === "qa-fixture").length,
      )
      .toBeGreaterThan(initialCalls);
    child.kill("SIGKILL");
    await child.exited;
    child = undefined;
    const calls = provider.requests.length;
    child = spawn();
    await wait();
    const [r] =
      await sql`select status,reason from knowledge_runs where id=${active.runId}`;
    expect(r).toMatchObject({
      status: "interrupted",
      reason: "application_restarted",
    });
    await p.goto(`/conversation?id=${c.id}`);
    await p.reload();
    await expect(p.locator("a[data-citation]")).toBeVisible();
    const saved = await p.request.get(`/api/runs/${done.runId}/events`);
    expect(await saved.json()).toMatchObject({
      saved: true,
      status: "completed",
      result: { outcome: "answer" },
    });
    expect(
      await (await p.request.get(`/api/runs/${active.runId}/events`)).json(),
    ).toMatchObject({ saved: true, status: "interrupted" });
    expect(provider.requests.length).toBe(calls);
    await expect(
      p.getByRole("heading", { name: "Restart history" }),
    ).toBeVisible();
    const [thread] =
      await sql`select messages from chat_threads where thread_id=${c.id}`;
    expect(thread.messages.filter((m: any) => m.role === "user")).toHaveLength(
      2,
    );
    provider.setDelay(60);
    await p.getByRole("button", { name: "重新发送" }).click();
    await expect(p.getByRole("status")).toHaveText("已完成");
    const history =
      await sql`select id,status,question from knowledge_runs where conversation_id=${c.id} order by created_at`;
    expect(history).toHaveLength(3);
    expect(history[1].status).toBe("interrupted");
    expect(history[2].id).not.toBe(active.runId);
    expect(history[2].question).toBe("Follow up");
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
    }
    await ctx.close();
    await sql.end();
    provider.server.stop(true);
  }
});
