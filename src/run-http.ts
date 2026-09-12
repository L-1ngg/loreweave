import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { KnowledgeHost, StartTurn } from "./host.ts";
import { credential, accessError } from "./http-common.ts";
import { isUuid, jsonInput } from "./http-input.ts";

/** Conversation transport; Host owns authorization, execution and settlement. */
export function runRoutes(host: KnowledgeHost, authenticated: boolean) {
  const app = new Hono();
  app.onError((error, context) => accessError(context, error));
  app.get("/runtime", (context) => context.json(host.configuration()));
  app.post("/runs", async (context) => {
    return context.json(
      await host.start({
        ...decodeTurn(await jsonInput(context)),
        ...(authenticated ? { credential: credential(context) } : {}),
      }),
      202,
    );
  });
  app.get("/conversations/:id", async (context) => {
    return context.json(
      await host.conversation(context.req.param("id"), credential(context)),
    );
  });
  app.get("/runs/:id", async (context) => {
    return context.json(
      await host.get(context.req.param("id"), credential(context)),
    );
  });
  app.post("/runs/:id/cancel", async (context) => {
    await host.cancel(context.req.param("id"), credential(context));
    return context.json(
      await host.get(context.req.param("id"), credential(context)),
    );
  });
  app.get("/runs/:id/events", async (context) => {
    const id = context.req.param("id");
    await host.get(id, credential(context));

    let after = Number(context.req.header("last-event-id") ?? "0");
    if (!Number.isSafeInteger(after) || after < 0)
      return context.json({ error: "invalid_input" }, 400);
    return streamSSE(context, async (stream) => {
      while (!stream.aborted) {
        for (const event of await host.events(id, after, credential(context))) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(event),
          });
          after = event.sequence;
        }
        if ((await host.get(id, credential(context))).settledAt) {
          const remaining = await host.events(id, after, credential(context));
          if (!remaining.length) break;
        }
        await stream.sleep(100);
      }
    });
  });
  return app;
}

/** Decode browser fields without accepting caller-supplied credentials or scope grants. */
function decodeTurn(input: unknown): Omit<StartTurn, "credential"> {
  if (
    !input ||
    typeof input !== "object" ||
    !("question" in input) ||
    typeof input.question !== "string" ||
    !input.question.trim() ||
    input.question.length > 8000
  )
    throw new Error("invalid_input");
  if (
    "attachmentIds" in input &&
    (!Array.isArray(input.attachmentIds) ||
      input.attachmentIds.length > 5 ||
      input.attachmentIds.some((id) => !isUuid(id)))
  )
    throw new Error("invalid_input");
  for (const key of ["sourceVersion", "pageId", "pageVersion"] as const)
    if (key in input && !isUuid((input as Record<string, unknown>)[key]))
      throw new Error("invalid_input");
  if ("pageVersion" in input && !("pageId" in input))
    throw new Error("invalid_input");
  if ("complex" in input && typeof input.complex !== "boolean")
    throw new Error("invalid_input");
  if (
    "conversationId" in input &&
    (typeof input.conversationId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.conversationId))
  )
    throw new Error("invalid_input");
  if (
    ("projectId" in input &&
      input.projectId !== null &&
      (typeof input.projectId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.projectId))) ||
    Object.keys(input).some(
      (key) =>
        ![
          "question",
          "complex",
          "conversationId",
          "projectId",
          "attachmentIds",
          "sourceVersion",
          "pageId",
          "pageVersion",
        ].includes(key),
    )
  )
    throw new Error("invalid_input");
  return {
    question: input.question,
    ...("sourceVersion" in input
      ? { sourceVersion: input.sourceVersion as string }
      : {}),
    ...("pageId" in input ? { pageId: input.pageId as string } : {}),
    ...("pageVersion" in input
      ? { pageVersion: input.pageVersion as string }
      : {}),
    ...("attachmentIds" in input
      ? { attachmentIds: input.attachmentIds as string[] }
      : {}),
    ...("projectId" in input
      ? { projectId: input.projectId as string | null }
      : {}),
    ...("conversationId" in input
      ? { conversationId: input.conversationId as string }
      : {}),
    complex: "complex" in input && input.complex === true,
  };
}
