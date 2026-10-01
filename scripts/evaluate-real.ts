import postgres from "postgres";
import { mkdtemp, rm, cp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadLocalConfiguration } from "./configuration";
import { evaluationProvider } from "./evaluation-provider";
import { rpc } from "../tests/support/rpc";
import { mcpClient, toolValue } from "../tests/support/mcp";
import { hashData } from "../src/server/library";
import { chromium, expect } from "@playwright/test";

await loadLocalConfiguration();
const provider = await evaluationProvider();
const resume = process.env.LOREWEAVE_EVAL_RESUME_FILE
  ? await Bun.file(process.env.LOREWEAVE_EVAL_RESUME_FILE).json()
  : null;
const dbUrl = new URL(process.env.LOREWEAVE_DATABASE_URL!);
dbUrl.pathname = "/postgres";
const admin = postgres(dbUrl.toString(), { max: 1, onnotice: () => {} });
const databaseName =
  resume?.retainedDatabase ?? `loreweave_pageindex_evaluation_${process.pid}`;
if (!/^loreweave_pageindex_evaluation_\d+$/.test(databaseName))
  throw new Error("unsafe_evaluation_database");
if (!resume) await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
dbUrl.pathname = `/${databaseName}`;
const artifacts =
  resume?.artifactDirectory ??
  (await mkdtemp(join(tmpdir(), "loreweave-pageindex-evaluation-")));
if (!artifacts.startsWith(join(tmpdir(), "loreweave-pageindex-evaluation-")))
  throw new Error("unsafe_evaluation_artifacts");
const compiled = await mkdtemp(join(tmpdir(), "loreweave-pageindex-build-"));
await cp("dist", compiled, { recursive: true });
await symlink(resolve("node_modules"), join(compiled, "node_modules"), "dir");
const reportPath =
  process.env.LOREWEAVE_EVAL_REPORT ?? "docs/evaluation/pageindex-real.json";
const report: any = {
  date: new Date().toISOString(),
  model: provider.model,
  protocol:
    "actual authorized compatible provider through maintained TanStack adapter; public compiled Start HTTP; real PostgreSQL",
  dataset: "tests/fixtures/questions.json",
  selection: {
    fixtures: process.env.LOREWEAVE_EVAL_FIXTURES?.split(",") ?? null,
    questions: process.env.LOREWEAVE_EVAL_QUESTIONS?.split(",") ?? null,
    deliberateFailedImportRetry:
      process.env.LOREWEAVE_EVAL_RETRY_FAILED === "1",
  },
  datasetSHA256: hashData(
    await Bun.file("tests/fixtures/questions.json").text(),
  ),
  imports: [],
  questions: [],
  compatibility: [],
  observations: [],
  semanticReview:
    "pending original-evidence review; automatic lexical checks are not semantic scores",
  failures: [],
  artifactDirectory: artifacts,
  retainedDatabase: databaseName,
};
if (resume) {
  report.imports = resume.imports;
  report.resumedFrom = process.env.LOREWEAVE_EVAL_RESUME_FILE;
  report.priorFailures = resume.failures;
}
const write = () =>
  Bun.write(reportPath, JSON.stringify(report, null, 2) + "\n");
const socket = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const port = socket.port;
socket.stop(true);
const origin = `http://127.0.0.1:${port}`;
const spawnServer = () =>
  Bun.spawn([process.execPath, "--no-env-file", "scripts/serve.ts"], {
    env: {
      ...process.env,
      LOREWEAVE_DATABASE_URL: dbUrl.toString(),
      LOREWEAVE_ARTIFACT_DIRECTORY: artifacts,
      LOREWEAVE_MODE: "real",
      LOREWEAVE_PORT: String(port),
      LOREWEAVE_BUILD_DIRECTORY: compiled,
    },
    stdout: "ignore",
    stderr: Bun.file(join(artifacts, "server.log")),
  });
let child = spawnServer();
let cookie = "";
const api = {
  async fetch(
    url: string,
    options: { method: string; headers: Record<string, string>; data?: string },
  ) {
    const response = await fetch(url, {
      method: options.method,
      headers: { ...options.headers, ...(cookie ? { cookie } : {}) },
      body: options.data,
    });
    const session = response.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return response;
  },
};
const sql = postgres(dbUrl.toString(), { max: 1 });
const call = (name: string, data?: unknown, method = "POST") =>
  rpc(api, name, data, method, origin, join(compiled, "server/server.js"));
const wait = async (
  table: "index_operations" | "knowledge_runs",
  id: string,
  maxMs = 1800000,
) => {
  const start = Date.now();
  for (;;) {
    const [row] = await sql.unsafe(
      `select status,reason from ${table} where id=$1`,
      [id],
    );
    if (
      row &&
      !["queued", "processing", "running", "stopping"].includes(row.status)
    )
      return row;
    if (Date.now() - start > maxMs) throw new Error(`${table}_poll_timeout`);
    await Bun.sleep(250);
  }
};
const waitServer = async () => {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* server startup */
    }
    if (child.exitCode !== null) throw new Error("evaluation_server_exited");
    await Bun.sleep(100);
  }
  throw new Error("evaluation_server_startup_timeout");
};
const exerciseLifetime = async (mode: string, doc: any) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: origin });
  const session = cookie.split("=");
  await context.addCookies([
    { name: session[0], value: session.slice(1).join("="), url: origin },
  ]);
  const page = await context.newPage();
  const scope = { mode: "selected", documentIds: [doc.documentId] };
  try {
    const conversation = await call("newConversation");
    const input = {
      conversationId: conversation.id,
      submissionId: crypto.randomUUID(),
      question:
        "Compare Acme 2026 and 2025 revenue and net profit with currency and scope, citing the originals.",
      scope,
    };
    provider.setLane(`lifetime:${mode}:disconnect`);
    const accepted = await call("askQuestion", input);
    const observed = await fetch(
      `${origin}/api/runs/${accepted.runId}/events`,
      {
        headers: { cookie },
      },
    );
    const reader = observed.body!.getReader();
    const first = await reader.read();
    await reader.cancel();
    const afterDisconnect = await call("getRun", { id: accepted.runId }, "GET");
    await page.goto(`/conversation?id=${conversation.id}`);
    await page.reload();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.close();
    const outcome = await wait("knowledge_runs", accepted.runId, 240000);
    expect(outcome.status).toBe("completed");
    const callsAtCompletion = provider.calls.length;
    const again = await context.newPage();
    await again.goto(`/conversation?id=${conversation.id}`);
    await expect(again.locator("a[data-citation]").first()).toBeVisible({
      timeout: 15000,
    });
    await again.reload();
    await expect(again.locator("a[data-citation]").first()).toBeVisible();
    const duplicate = await call("askQuestion", input);
    expect(duplicate).toMatchObject({ runId: accepted.runId, created: false });
    const saved = await call("getConversation", { id: conversation.id }, "GET");
    const callsAfterReattach = provider.calls.length;
    expect(callsAfterReattach).toBe(callsAtCompletion);
    const userMessages = JSON.parse(saved.transcript).filter(
      (m: any) => m.role === "user",
    ).length;
    expect(userMessages).toBe(1);
    report.observations.push({
      mode,
      kind: "real_disconnect_reload_closure",
      runId: accepted.runId,
      firstEventBytes: first.value?.byteLength ?? 0,
      statusAfterReaderCancellation: afterDisconnect.status,
      terminalStatus: outcome.status,
      callsAtCompletion,
      callsAfterReattach,
      extraCallsAfterReattach: callsAfterReattach - callsAtCompletion,
      duplicate,
      userMessages,
    });
    await again.close();
    const inFlight = async (offset: number) => {
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const dispatched = provider.calls
          .slice(offset)
          .find((c) => c.status === 200 && c.elapsedMs === undefined);
        if (dispatched) return dispatched;
        await Bun.sleep(20);
      }
      throw new Error("real_request_in_flight_not_observed");
    };
    provider.setLane(`lifetime:${mode}:stop`);
    const stopOffset = provider.calls.length;
    const stoppedInput = {
      ...input,
      submissionId: crypto.randomUUID(),
      question:
        "Give a detailed source-grounded comparison of both years with all available qualifications.",
    };
    const stopped = await call("askQuestion", stoppedInput);
    const startedRequest = await inFlight(stopOffset);
    const stopStarted = Date.now();
    const stop = await call("stopQuestion", { id: stopped.runId });
    expect(stop.status).toBe("stopped");
    const stoppedRun = await call("getRun", { id: stopped.runId }, "GET");
    expect(stoppedRun.result).toBeNull();
    await expect
      .poll(() => startedRequest.elapsedMs, { timeout: 15000 })
      .toBeDefined();
    report.observations.push({
      mode,
      kind: "real_explicit_stop",
      runId: stopped.runId,
      status: stop.status,
      localStopMs: Date.now() - stopStarted,
      proxyObservedAbort: startedRequest.cancelled ?? false,
      requestError: startedRequest.error ?? null,
      usage: stoppedRun.usage,
      remoteExecutionEnded:
        "not observable; local abort is not proof of remote termination or zero billing",
    });
    await write();
    provider.setLane(`lifetime:${mode}:interruption`);
    const interruptOffset = provider.calls.length;
    const interrupted = await call("askQuestion", {
      ...input,
      submissionId: crypto.randomUUID(),
      question:
        "Explain both years and the qualifications in detail from the original pages.",
    });
    await inFlight(interruptOffset);
    child.kill("SIGKILL");
    await child.exited;
    const callsBeforeRestart = provider.calls.length;
    child = spawnServer();
    await waitServer();
    const recovered = await call("getRun", { id: interrupted.runId }, "GET");
    expect(recovered.status).toBe("interrupted");
    const history = await call(
      "getConversation",
      { id: conversation.id },
      "GET",
    );
    expect(history.runs).toHaveLength(3);
    expect(history.activeRun).toBeNull();
    const restored = await context.newPage();
    await restored.goto(`/conversation?id=${conversation.id}`);
    await restored.reload();
    await expect(restored.locator("a[data-citation]").first()).toBeVisible();
    const callsAfterRestart = provider.calls.length;
    expect(callsAfterRestart).toBe(callsBeforeRestart);
    report.observations.push({
      mode,
      kind: "real_process_interruption",
      runId: interrupted.runId,
      status: recovered.status,
      reason: recovered.reason,
      committedMessages: JSON.parse(history.transcript).length,
      runStatuses: history.runs.map((r: any) => r.status),
      callsBeforeRestart,
      callsAfterRestart,
      replayedCalls: callsAfterRestart - callsBeforeRestart,
      remoteExecutionEnded: "unknown after process loss; no automatic replay",
    });
    await write();
  } finally {
    await context.close();
    await browser.close();
  }
};
try {
  await waitServer();
  await call("loginOwner", { password: process.env.LOREWEAVE_ACCESS_PASSWORD });
  const connection = await call("putConnection", {
    name: "Authorized evaluation",
    provider: "openai-compatible",
    baseURL: provider.url,
    apiKey: provider.key,
  });
  for (const role of ["index", "qa"]) {
    await call("putRole", {
      role,
      connectionId: connection.id,
      model: provider.model,
    });
    provider.setLane(`verify:${role}`);
    try {
      report.compatibility.push(await call("testRole", { role }));
    } catch (e) {
      report.compatibility.push({ role, error: String(e) });
      throw e;
    }
  }
  const originalManifest = await Bun.file(
    "tests/fixtures/pdf/manifest.json",
  ).json();
  const extra = await Bun.file(
    "tests/fixtures/pdf/question-manifest.json",
  ).json();
  const boundary = await Bun.file(
    "tests/fixtures/pdf/boundary-manifest.json",
  ).json();
  const boundaryEntry = {
    file: "boundary-20.pdf",
    sha256: boundary.sha256 ?? boundary.outputSHA256,
    pages: 20,
  };
  const fixtures = [
    ...originalManifest.fixtures,
    ...extra.fixtures,
    boundaryEntry,
  ].filter(
    (f) =>
      !report.selection.fixtures || report.selection.fixtures.includes(f.file),
  );
  const dataset = await Bun.file("tests/fixtures/questions.json").json();
  const modes = (process.env.LOREWEAVE_EVAL_MODES ?? "flash,standard").split(
    ",",
  );
  for (const mode of modes) {
    const documents = new Map<string, any>();
    for (const fixture of fixtures) {
      const previous = report.imports.find(
        (d: any) =>
          d.mode === mode &&
          d.file === fixture.file &&
          d.sha256 === fixture.sha256,
      );
      if (previous) {
        documents.set(fixture.file, previous);
        continue;
      }
      const bytes = await Bun.file(
        `tests/fixtures/pdf/${fixture.file}`,
      ).arrayBuffer();
      if (hashData(new Uint8Array(bytes)) !== fixture.sha256)
        throw new Error(`frozen_fixture_changed:${fixture.file}`);
      const started = Date.now();
      provider.setLane(`ts:${mode}:${fixture.file}`);
      const form = new FormData();
      form.set(
        "file",
        new File([bytes], fixture.file, { type: "application/pdf" }),
      );
      form.set("mode", mode);
      form.set("submissionId", crypto.randomUUID());
      const response = await fetch(`${origin}/api/documents`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      });
      if (response.status !== 202)
        throw new Error(`upload_rejected:${response.status}`);
      const ids = await response.json();
      let outcome = await wait("index_operations", ids.operationId);
      let deliberateRetry = null;
      if (
        report.selection.deliberateFailedImportRetry &&
        outcome.status === "failed"
      ) {
        const originalOperation = await call(
          "getOperation",
          { id: ids.operationId },
          "GET",
        );
        const input = {
          operationId: ids.operationId,
          mode,
          submissionId: crypto.randomUUID(),
        };
        provider.setLane(`ts:${mode}:${fixture.file}:deliberate-retry`);
        const accepted = await call("retryOperation", input);
        const duplicate = await call("retryOperation", input);
        expect(duplicate).toMatchObject({
          attemptId: accepted.attemptId,
          operationId: ids.operationId,
          created: false,
        });
        deliberateRetry = {
          originalOutcome: outcome,
          originalOperation,
          accepted,
          duplicate,
        };
        await Bun.write(
          `${reportPath}.retry-checkpoint.json`,
          JSON.stringify(
            { file: fixture.file, mode, ...ids, deliberateRetry },
            null,
            2,
          ) + "\n",
        );
        outcome = await wait("index_operations", ids.operationId);
      }
      const operation = await call(
        "getOperation",
        { id: ids.operationId },
        "GET",
      );
      const doc = await call("getDocument", { id: ids.documentId }, "GET");
      const [index] =
        await sql`select tree,provenance from index_revisions where id=${doc.indexId ?? crypto.randomUUID()}`;
      const pages =
        await sql`select physical_page,artifact from document_pages where version_id=${ids.versionId} order by physical_page`;
      const entry = {
        mode,
        file: fixture.file,
        sha256: fixture.sha256,
        ...ids,
        ...outcome,
        deliberateRetry,
        elapsedMs: Date.now() - started,
        operation,
        tree: index?.tree ?? [],
        provenance: index?.provenance ?? null,
        pages: pages.map((p) => p.artifact),
      };
      report.imports.push(entry);
      documents.set(fixture.file, entry);
      await write();
      console.log(
        `TS ${mode} ${fixture.file}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`,
      );
    }
    const conversations = new Map<string, string>();
    for (const q of dataset.questions.filter(
      (q: any) =>
        !report.selection.questions ||
        report.selection.questions.includes(q.id),
    )) {
      const selected = q.files.map((f: string) => documents.get(f));
      if (selected.some((d: any) => !d || d.status !== "ready")) {
        report.questions.push({
          id: q.id,
          mode,
          status: "not_run",
          why: "required import not ready",
        });
        await write();
        continue;
      }
      const conversationId = q.after
        ? conversations.get(q.after)
        : (await call("newConversation")).id;
      if (!conversationId) {
        report.questions.push({
          id: q.id,
          mode,
          status: "not_run",
          why: "preceding question unavailable",
        });
        continue;
      }
      conversations.set(q.id, conversationId);
      provider.setLane(`qa:${mode}:${q.id}`);
      const started = Date.now();
      const accepted = await call("askQuestion", {
        conversationId,
        submissionId: crypto.randomUUID(),
        question: q.question,
        scope: q.files.length
          ? {
              mode: "selected",
              documentIds: selected.map((d: any) => d.documentId),
            }
          : { mode: "library" },
      });
      const outcome = await wait("knowledge_runs", accepted.runId, 240000);
      const run = await call("getRun", { id: accepted.runId }, "GET");
      const citations = [
        ...(run.result?.text ?? "").matchAll(/\]\(cite:([^\s)]+)\)/g),
      ].map((m) => m[1]);
      const reads =
        await sql`select document_id,version_id,physical_page,start_offset,end_offset,content_digest,id from source_references where run_id=${accepted.runId}`;
      const evidence = reads
        .filter((r) => citations.includes(r.id))
        .map((r) => {
          const original = [...documents.values()].find(
            (d) => d.versionId === r.version_id,
          );
          return {
            referenceId: r.id,
            file: original?.file,
            versionId: r.version_id,
            page: r.physical_page,
            text: original?.pages
              .find((p: any) => p.number === r.physical_page)
              ?.text.slice(r.start_offset, r.end_offset),
            contentDigest: r.content_digest,
          };
        });
      report.questions.push({
        id: q.id,
        mode,
        question: q.question,
        conversationId,
        ...accepted,
        ...outcome,
        run,
        elapsedMs: Date.now() - started,
        evidence,
        checks: {
          expectedOutcome: run.result?.outcome === q.outcome,
          lexicalFacts: q.expected.every((s: string) =>
            run.result?.text.toLowerCase().includes(s.toLowerCase()),
          ),
          citedExpectedOriginals: q.evidence.every((expected: any) =>
            evidence.some(
              (e) =>
                e.file === expected.file &&
                expected.pages.includes(e.page) &&
                e.text?.includes(expected.contains),
            ),
          ),
        },
      });
      await write();
      console.log(
        `QA ${mode} ${q.id}: ${outcome.status} / ${run.result?.outcome ?? outcome.reason}`,
      );
    }
    // Real independent QA through the official MCP client, without a Web thread.
    const doc = documents.get("single-column.pdf");
    if (doc?.status === "ready") {
      const token = await call("newToken", { name: `Evaluation ${mode}` });
      const mcp = await mcpClient(token.token, origin);
      provider.setLane(`mcp:${mode}:revenue`);
      try {
        const started = Date.now();
        const result = toolValue(
          await mcp.client.callTool(
            {
              name: "question_answer",
              arguments: {
                question: dataset.questions[0].question,
                scope: { mode: "selected", documentIds: [doc.documentId] },
              },
            },
            { timeout: 240000 },
          ),
        );
        report.questions.push({
          id: "mcp-revenue",
          mode,
          channel: "mcp",
          elapsedMs: Date.now() - started,
          result,
        });
      } finally {
        await mcp.client.close();
        await call("removeToken", { id: token.id });
      }
    }
    if (process.env.LOREWEAVE_EVAL_LIFECYCLE === "1" && doc?.status === "ready")
      await exerciseLifetime(mode, doc);
    // Retire mode-specific library items before evaluating library discovery in
    // the next mode; history and artifacts remain in this isolated database.
    for (const doc of documents.values())
      await call("retireSource", { id: doc.documentId });
  }
  report.accounting = await provider.finish();
  // Paired upstream work has the same frozen bytes and explicit model. It is
  // launched separately so Python never becomes an application dependency.
} catch (error) {
  report.failures.push(String(error));
  report.accounting = await provider.finish();
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await write();
  child.kill();
  await child.exited;
  await sql.end();
  if (process.env.LOREWEAVE_EVAL_KEEP !== "1") {
    await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await rm(artifacts, { recursive: true });
  } else report.retainedDatabase = databaseName;
  await admin.end();
  await rm(compiled, { recursive: true });
  await write();
}
