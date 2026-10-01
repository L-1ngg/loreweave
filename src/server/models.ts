import { and, eq } from "drizzle-orm";
import { chat, toolDefinition, maxIterations } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { z } from "zod";
import { database } from "./database";
import { modelConnections, connectionRevisions, modelRoles } from "./schema";
import { seal, unseal } from "./secrets";
import { configuration } from "./config";
import { type Actor, requireManagement } from "./access";
import { fail } from "./errors";
import {
  connectionInput,
  roleInput,
  type ConnectionInput,
  type RoleInput,
} from "../contracts/settings";

export type CapturedModel = {
  ownerId: string;
  role: "index" | "qa";
  connectionId: string;
  revisionId: string;
  provider: "openai" | "openai-compatible";
  baseURL: string;
  model: string;
  budgets: ReturnType<typeof budgetDefaults>;
};
export function budgetDefaults(role: "index" | "qa") {
  const positive = (key: string, fallback: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .parse(process.env[key] ?? fallback);
  return {
    modelCalls: positive(
      role === "index" ? "LOREWEAVE_INDEX_CALLS" : "LOREWEAVE_QA_CALLS",
      role === "index" ? 120 : 16,
    ),
    toolCalls: positive("LOREWEAVE_QA_TOOL_CALLS", 60),
    pages: positive(
      role === "index" ? "LOREWEAVE_INDEX_PAGES" : "LOREWEAVE_QA_PAGES",
      role === "index" ? 2000 : 160,
    ),
    contextChars: positive("LOREWEAVE_CONTEXT_CHARS", 60000),
    outputChars: positive("LOREWEAVE_OUTPUT_CHARS", 100000),
    elapsedMs: positive(
      role === "index"
        ? "LOREWEAVE_INDEX_TIMEOUT_MS"
        : "LOREWEAVE_QA_TIMEOUT_MS",
      role === "index" ? 1800000 : 180000,
    ),
  };
}
export async function settings(actor: Actor) {
  requireManagement(actor);
  const connections = await database()
    .db.select({
      id: modelConnections.id,
      name: modelConnections.name,
      revisionId: connectionRevisions.id,
      provider: connectionRevisions.provider,
      baseURL: connectionRevisions.baseURL,
      createdAt: modelConnections.createdAt,
    })
    .from(modelConnections)
    .innerJoin(
      connectionRevisions,
      eq(modelConnections.currentRevision, connectionRevisions.id),
    )
    .where(eq(modelConnections.ownerId, actor.ownerId));
  const roles = await database()
    .db.select({
      role: modelRoles.role,
      connectionId: modelRoles.connectionId,
      model: modelRoles.model,
    })
    .from(modelRoles)
    .where(eq(modelRoles.ownerId, actor.ownerId));
  return {
    connections: connections.map((c) => ({ ...c, hasSecret: true })),
    roles,
  };
}
export async function saveConnection(actor: Actor, input: ConnectionInput) {
  requireManagement(actor);
  const value = connectionInput.parse(input);
  const id = value.id ?? crypto.randomUUID();
  const revision = crypto.randomUUID();
  const baseURL = value.baseURL || "https://api.openai.com/v1";
  const url = new URL(baseURL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    fail("invalid_base_url");
  await database().db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(modelConnections)
      .where(
        and(
          eq(modelConnections.id, id),
          eq(modelConnections.ownerId, actor.ownerId),
        ),
      )
      .for("update");
    if (value.id && !existing) fail("connection_not_found", 404);
    if (existing && existing.currentRevision !== value.expectedRevision)
      fail("connection_changed", 409);
    const [old] = existing
      ? await tx
          .select()
          .from(connectionRevisions)
          .where(eq(connectionRevisions.id, existing.currentRevision))
      : [];
    const key =
      value.apiKey ??
      (old && unseal(old.sealedKey, `${actor.ownerId}:${old.id}`));
    if (!key) fail("api_key_required");
    if (!existing)
      await tx.insert(modelConnections).values({
        id,
        ownerId: actor.ownerId,
        name: value.name,
        currentRevision: revision,
      });
    await tx.insert(connectionRevisions).values({
      id: revision,
      connectionId: id,
      provider: value.provider,
      baseURL: baseURL.replace(/\/$/, ""),
      sealedKey: seal(key, `${actor.ownerId}:${revision}`),
    });
    if (existing)
      await tx
        .update(modelConnections)
        .set({ name: value.name, currentRevision: revision })
        .where(eq(modelConnections.id, id));
  });
  return { id, revisionId: revision };
}
export async function saveRole(actor: Actor, input: RoleInput) {
  requireManagement(actor);
  const value = roleInput.parse(input);
  const [connection] = await database()
    .db.select()
    .from(modelConnections)
    .where(
      and(
        eq(modelConnections.id, value.connectionId),
        eq(modelConnections.ownerId, actor.ownerId),
      ),
    );
  if (!connection) fail("connection_not_found", 404);
  await database()
    .db.insert(modelRoles)
    .values({ ...value, ownerId: actor.ownerId })
    .onConflictDoUpdate({
      target: [modelRoles.ownerId, modelRoles.role],
      set: { connectionId: value.connectionId, model: value.model },
    });
  return { ok: true };
}
export async function captureModel(
  actor: Actor,
  role: "index" | "qa",
): Promise<CapturedModel> {
  const [row] = await database()
    .db.select({
      connectionId: modelConnections.id,
      revisionId: connectionRevisions.id,
      provider: connectionRevisions.provider,
      baseURL: connectionRevisions.baseURL,
      model: modelRoles.model,
    })
    .from(modelRoles)
    .innerJoin(
      modelConnections,
      eq(modelRoles.connectionId, modelConnections.id),
    )
    .innerJoin(
      connectionRevisions,
      eq(modelConnections.currentRevision, connectionRevisions.id),
    )
    .where(
      and(
        eq(modelRoles.ownerId, actor.ownerId),
        eq(modelRoles.role, role),
        eq(modelConnections.ownerId, actor.ownerId),
      ),
    );
  if (!row) fail(`model_role_missing:${role}`, 409);
  return {
    ...row,
    ownerId: actor.ownerId,
    role,
    budgets: budgetDefaults(role),
  };
}
export async function modelAdapter(captured: CapturedModel) {
  const [record] = await database()
    .db.select({ sealedKey: connectionRevisions.sealedKey })
    .from(connectionRevisions)
    .innerJoin(
      modelConnections,
      eq(modelConnections.id, connectionRevisions.connectionId),
    )
    .where(
      and(
        eq(connectionRevisions.id, captured.revisionId),
        eq(connectionRevisions.connectionId, captured.connectionId),
        eq(modelConnections.ownerId, captured.ownerId),
      ),
    );
  if (!record) fail("captured_connection_missing", 409);
  if (
    configuration().mode === "fixture" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(captured.baseURL).hostname,
    )
  )
    fail("fixture_endpoint_required", 409);
  return openaiCompatibleText(captured.model, {
    api: "chat-completions",
    name: captured.provider,
    baseURL: captured.baseURL,
    apiKey: unseal(
      record.sealedKey,
      `${captured.ownerId}:${captured.revisionId}`,
    ),
    maxRetries: 0,
    timeout: Math.min(captured.budgets.elapsedMs, 120000),
  });
}
export async function verifyRole(actor: Actor, role: "index" | "qa") {
  requireManagement(actor);
  const captured = await captureModel(actor, role);
  const adapter = await modelAdapter(captured);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("model_verification_timeout")),
    Math.min(captured.budgets.elapsedMs, 180000),
  );
  try {
    const probe = toolDefinition({
      name: "capability_probe",
      description:
        "Read the required capability verification value. Call this tool before answering.",
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
    }).server(() => ({ value: 42 }));
    let called = false;
    const chunks = chat({
      adapter,
      messages: [
        { role: "user", content: "Call capability_probe, then say its value." },
      ],
      tools: [probe],
      agentLoopStrategy: maxIterations(3),
      abortController: controller,
      debug: false,
    });
    let text = "";
    for await (const chunk of chunks) {
      if (
        chunk.type === "TOOL_CALL_START" &&
        chunk.toolCallName === "capability_probe"
      )
        called = true;
      if (chunk.type === "TEXT_MESSAGE_CONTENT") text += chunk.delta;
      if (chunk.type === "RUN_ERROR") fail("model_protocol_failed", 422);
    }
    if (!called || !text.includes("42"))
      fail("model_tool_stream_unsupported", 422);
    const output = await chat({
      adapter,
      messages: [
        { role: "user", content: "Return the object with numeric value 42." },
      ],
      outputSchema: z.object({ value: z.literal(42) }),
      abortController: controller,
      debug: false,
    });
    if (output.value !== 42) fail("model_schema_unsupported", 422);
    return {
      ok: true,
      role,
      revisionId: captured.revisionId,
      model: captured.model,
      tested: ["tools", "stream", "structured"],
    };
  } catch (error) {
    if (controller.signal.aborted) fail("model_verification_timeout", 422);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
