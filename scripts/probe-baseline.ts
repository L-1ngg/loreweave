import { strict as assert } from "node:assert";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  chat,
  createModel,
  extendAdapter,
  RUN_CANCEL_REASON,
} from "@tanstack/ai";
import { createOpenaiChatCompletions } from "@tanstack/ai-openai";
import { memoryPersistence } from "@tanstack/ai-persistence";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { chromium } from "@playwright/test";
import { z } from "zod";
import postgres from "postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalConfiguration } from "./configuration";
import { startProbeProvider } from "../tests/support/provider";
import { evaluationOutputPath } from "./evaluation-artifacts";

await loadLocalConfiguration();
const url = new URL(process.env.LOREWEAVE_DATABASE_URL!);
url.pathname = "/postgres";
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
const databaseName = `loreweave_pageindex_probe_${process.pid}`;
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
url.pathname = `/${databaseName}`;
const artifacts = await mkdtemp(join(tmpdir(), "loreweave-pageindex-probe-"));
const provider = startProbeProvider();
const socket = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const port = socket.port;
socket.stop(true);
const base = `http://127.0.0.1:${port}`;
const child = Bun.spawn(
  [process.execPath, "--no-env-file", "scripts/serve.ts"],
  {
    env: {
      ...process.env,
      LOREWEAVE_PORT: String(port),
      LOREWEAVE_MODE: "fixture",
      LOREWEAVE_PROBE_PROVIDER: provider.url,
      LOREWEAVE_DATABASE_URL: url.toString(),
      LOREWEAVE_ARTIFACT_DIRECTORY: artifacts,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
);
const secret = process.env.LOREWEAVE_ACCESS_PASSWORD!;
const headers = { "x-probe-key": secret };
const evidence: Record<string, unknown> = {
  date: new Date().toISOString(),
  bun: Bun.version,
  provider: "controlled loopback; no real-model quality measured",
  isolation:
    "disposable independent PostgreSQL database and original directory; no application-history mutation",
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }
  const html = await (await fetch(`${base}/baseline-probe`)).text();
  assert(html.includes("LoreWeave") && html.includes("Bun"));
  assert(!html.includes(secret));
  assert.equal((await fetch(`${base}/api/probe`)).status, 401);
  assert.equal(
    (await (await fetch(`${base}/api/probe`, { headers })).json()).rows[0]
      .value,
    42,
  );
  evidence.ssrAndPostgres = "passed";

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Chapter 1. Probe original: value 42.", {
    x: 60,
    y: 700,
    size: 18,
    font,
  });
  const bytes = await pdf.save();
  const form = new FormData();
  form.set(
    "file",
    new File([bytes.slice().buffer], "probe.pdf", { type: "application/pdf" }),
  );
  const upload = await fetch(`${base}/api/probe`, {
    method: "POST",
    headers,
    body: form,
  });
  const extracted = await upload.json();
  assert.equal(upload.status, 200);
  assert.equal(extracted.pageCount, 1);
  assert(extracted.pages[0].text.includes("value 42"));
  const original = await fetch(`${base}/api/probe?kind=original`, { headers });
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  const head = await fetch(`${base}/api/probe?kind=original`, {
    method: "HEAD",
    headers,
  });
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  const range = await fetch(`${base}/api/probe?kind=original`, {
    headers: { ...headers, Range: "bytes=0-9" },
  });
  assert.equal(range.status, 206);
  assert(
    Buffer.from(await range.arrayBuffer()).equals(
      Buffer.from(bytes.slice(0, 10)),
    ),
    "Range must deliver exactly the requested bytes",
  );
  evidence.pdfUploadHeadRange = "passed";

  const factory = extendAdapter(createOpenaiChatCompletions, [
    createModel("fixture", ["text"]),
  ]);
  const structured = await chat({
    adapter: factory("fixture", "fixture-key", {
      baseURL: provider.url,
      maxRetries: 0,
    }),
    messages: [{ role: "user", content: "return a value" }],
    outputSchema: z.object({ value: z.number() }),
  });
  assert.equal(structured.value, 42);
  const run = crypto.randomUUID();
  const started = performance.now();
  const first = await fetch(`${base}/api/probe?kind=stream&run=${run}`, {
    headers,
  });
  const reader = first.body!.getReader();
  assert(!(await reader.read()).done);
  evidence.sseFirstChunkMs = Math.round(performance.now() - started);
  await reader.cancel();
  await Bun.sleep(600);
  const before = provider.requests.length;
  const replay = await (
    await fetch(`${base}/api/probe?kind=stream&replay=1&run=${run}`, {
      headers,
    })
  ).text();
  assert(replay.includes("42.") && replay.includes("read_probe"));
  assert.equal(provider.requests.length, before);
  assert.equal(
    provider.requests.filter((r) => r.stream && !r.structured).length,
    2,
  );
  evidence.toolStructuredZeroObserverReplay = {
    passed: true,
    streamingCalls: 2,
    structuredCalls: 1,
    callsAddedByReplay: 0,
  };

  const cancellation = new AbortController();
  let aborted = false;
  let partial = "";
  const cancellable = chat({
    adapter: factory("fixture", "fixture-key", {
      baseURL: provider.url,
      maxRetries: 0,
    }),
    messages: [{ role: "user", content: "probe cancellation" }],
    abortController: cancellation,
    middleware: [
      {
        name: "probe-abort",
        onAbort: () => {
          aborted = true;
        },
      },
    ],
  });
  for await (const chunk of cancellable) {
    if (chunk.type === "TEXT_MESSAGE_CONTENT") {
      partial += chunk.delta;
      cancellation.abort(RUN_CANCEL_REASON);
    }
  }
  assert(aborted && cancellation.signal.aborted);
  assert(partial.length < "The value is 42.".length);
  evidence.explicitCancellation =
    "SDK abort observed; provider output stopped before completion; remote billing is not asserted";

  const client = new Client({
    name: "loreweave-baseline-probe",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${base}/mcp-probe`),
    { requestInit: { headers: { Authorization: `Bearer ${secret}` } } },
  );
  await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, "read_probe");
  const result = await client.callTool({ name: "read_probe", arguments: {} });
  assert(JSON.stringify(result).includes("42"));
  await client.close();
  evidence.officialMcpClient =
    "passed (official client 2.0.0, negotiated Streamable HTTP)";

  const persistence = memoryPersistence();
  await persistence.stores.messages.saveThread("probe", [
    { role: "user", content: "hello" },
  ]);
  assert.equal(
    (await persistence.stores.messages.loadThread("probe")).length,
    1,
  );
  const record = await persistence.stores.runs.createOrResume({
    runId: "probe-run",
    threadId: "probe",
    startedAt: Date.now(),
  });
  assert.equal(record.runId, "probe-run");
  evidence.persistenceContract =
    "MessageStore and RunStore reference shape passed; PostgreSQL conformance is P11";

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    let serverFunctionUrl = "";
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/_serverFn/"))
        serverFunctionUrl = request.url();
    });
    await page.goto(`${base}/baseline-probe`);
    await page.getByTestId("baseline").waitFor();
    assert.equal(await page.getByTestId("baseline").textContent(), "Bun");
    await page.getByLabel("Probe key").fill(secret);
    await page.getByRole("button", { name: "Probe" }).click();
    await page.getByTestId("private-probe").filter({ hasText: "42" }).waitFor();
    assert(serverFunctionUrl, "Protected RPC must be invoked through HTTP");
    assert.equal(
      (
        await fetch(serverFunctionUrl, {
          headers: {
            "x-tsr-serverFn": "true",
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
      401,
    );
    assert.deepEqual(errors, []);
    evidence.hydrationProtectedServerFunction =
      "passed in compiled Bun app via Chromium";
  } finally {
    await browser.close();
  }
  const bundle =
    await Bun.$`rg -l "fixture-key|LOREWEAVE_SECRET_KEY|database_isolation_required|postgres-js|read_probe" dist/client`
      .quiet()
      .nothrow();
  assert.equal(bundle.exitCode, 1);
  evidence.serverOnlyBundle = "passed";
  await Bun.write(
    evaluationOutputPath("pageindex-baseline-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  child.kill();
  await child.exited;
  provider.server.stop(true);
  await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  await rm(artifacts, { recursive: true });
}
