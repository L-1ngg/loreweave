import {
  toolDefinition,
  chat,
  createModel,
  extendAdapter,
  memoryStream,
  resumeServerSentEventsResponse,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { createOpenaiChatCompletions } from "@tanstack/ai-openai";
import { createMCPServer } from "@tanstack/ai-mcp/server";
import { z } from "zod";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { configuration } from "./config";
import { extractPdf } from "./pdf-engine";

export function probeAuthorized(request: Request) {
  const c = configuration();
  return (
    c.mode === "fixture" &&
    (request.headers.get("x-probe-key") === c.accessPassword ||
      request.headers.get("authorization") === `Bearer ${c.accessPassword}`)
  );
}
export function requireProbe(request: Request) {
  if (!probeAuthorized(request))
    throw new Response("Unauthorized", { status: 401 });
}
export async function databaseProbe() {
  const client = postgres(configuration().databaseUrl, { max: 1 });
  try {
    const rows = await drizzle(client).execute(
      sql`select current_database() as database, 42 as value`,
    );
    return rows.map((row) => ({
      database: String(row.database),
      value: Number(row.value),
    }));
  } finally {
    await client.end();
  }
}
export async function uploadProbe(request: Request) {
  requireProbe(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 1024 * 1024)
    return Response.json({ error: "invalid_pdf" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await extractPdf(bytes);
  const root = configuration().artifactDirectory;
  await mkdir(root, { recursive: true, mode: 0o700 });
  await Bun.write(join(root, "baseline.pdf"), bytes);
  return Response.json(result);
}
export async function originalProbe(request: Request) {
  requireProbe(request);
  const file = Bun.file(
    join(configuration().artifactDirectory, "baseline.pdf"),
  );
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.size}` },
      });
    const start = Number(m[1]);
    const end = Math.min(Number(m[2] || file.size - 1), file.size - 1);
    if (start > end || start >= file.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.size}` },
      });
    headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(
      request.method === "HEAD"
        ? null
        : await file.slice(start, end + 1).arrayBuffer(),
      { status: 206, headers },
    );
  }
  headers.set("Content-Length", String(file.size));
  return new Response(request.method === "HEAD" ? null : file, { headers });
}
const probeTool = toolDefinition({
  name: "read_probe",
  description: "Read the probe value",
  inputSchema: z.object({}).strict(),
}).server(() => ({ value: 42 }));
const mcp = createMCPServer({
  name: "loreweave-baseline",
  version: "0.1.0",
  tools: [probeTool],
});
export async function mcpProbe(request: Request) {
  requireProbe(request);
  return mcp.handle(request, {
    authInfo: { token: "probe", clientId: "probe", scopes: ["read"] },
  });
}
export function modelProbe(request: Request) {
  requireProbe(request);
  const url = new URL(request.url);
  const runId = url.searchParams.get("run") ?? crypto.randomUUID();
  if (url.searchParams.get("replay") === "1")
    return resumeServerSentEventsResponse({
      adapter: memoryStream({ runId, offset: "-1" }),
    });
  const endpoint = process.env.LOREWEAVE_PROBE_PROVIDER;
  if (!endpoint?.startsWith("http://127.0.0.1:"))
    return new Response("Explicit loopback provider required", { status: 400 });
  const factory = extendAdapter(createOpenaiChatCompletions, [
    createModel("fixture", ["text"]),
  ]);
  const controller = new AbortController();
  const stream = chat({
    adapter: factory("fixture", "fixture-key", {
      baseURL: endpoint,
      maxRetries: 0,
    }),
    messages: [{ role: "user", content: "probe tool" }],
    tools: [probeTool],
    abortController: controller,
  });
  return toServerSentEventsResponse(stream, {
    abortController: controller,
    durability: { adapter: memoryStream({ runId }), batch: 1 },
  });
}
