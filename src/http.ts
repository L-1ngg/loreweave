import { SourceService } from "./sources.ts";
import { sourceRoutes, isUuid } from "./source-http.ts";
import { AccessService } from "./access.ts";
import { accessRoutes, credential, accessError } from "./access-http.ts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { KnowledgeHost } from "./host.ts";
import { FixtureSources } from "./development/sources.ts";

/** Development-only transport. Binding and origin checks do not replace M01 auth. */
export function createApp(
  host: KnowledgeHost,
  sources: FixtureSources,
  options: {
    browserOrigin?: string;
    access?: AccessService;
    imports?: SourceService;
  } = {},
) {
  const app = new Hono();
  app.onError((error, context) => accessError(context, error));
  app.use("/api/*", async (context, next) => {
    const url = new URL(context.req.url);
    const origin = context.req.header("origin");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      (origin && origin !== url.origin && origin !== options.browserOrigin)
    )
      return context.json({ error: "forbidden" }, 403);
    await next();
  });
  if (options.access) {
    app.route("/api", accessRoutes(options.access));
    app.use("/api/*", async (context, next) => {
      try {
        await options.access!.identity(credential(context));
      } catch (error) {
        return accessError(context, error);
      }
      await next();
    });
  }
  if (options.imports) app.route("/api", sourceRoutes(options.imports));
  app.post("/api/runs", async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: "invalid_input" }, 400);
    }
    if (
      !input ||
      typeof input !== "object" ||
      !("question" in input) ||
      typeof input.question !== "string" ||
      !input.question.trim() ||
      input.question.length > 8000
    )
      return context.json({ error: "invalid_input" }, 400);
    if (
      "attachmentIds" in input &&
      (!Array.isArray(input.attachmentIds) ||
        input.attachmentIds.length > 5 ||
        input.attachmentIds.some((id) => !isUuid(id)))
    )
      return context.json({ error: "invalid_input" }, 400);
    if ("complex" in input && typeof input.complex !== "boolean")
      return context.json({ error: "invalid_input" }, 400);
    if (
      "conversationId" in input &&
      (typeof input.conversationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.conversationId))
    )
      return context.json({ error: "invalid_input" }, 400);
    if (
      ("projectId" in input &&
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
          ].includes(key),
      )
    )
      return context.json({ error: "invalid_input" }, 400);
    try {
      return context.json(
        await host.start({
          question: input.question,
          ...("attachmentIds" in input
            ? { attachmentIds: input.attachmentIds as string[] }
            : {}),
          ...(options.access ? { credential: credential(context) } : {}),
          ...("projectId" in input
            ? { projectId: input.projectId as string }
            : {}),
          ...("conversationId" in input
            ? { conversationId: input.conversationId as string }
            : {}),
          complex: "complex" in input && input.complex === true,
        }),
        202,
      );
    } catch (error) {
      return accessError(context, error);
    }
  });
  app.get("/api/conversations/:id", async (context) => {
    try {
      return context.json(
        await host.conversation(context.req.param("id"), credential(context)),
      );
    } catch (error) {
      return accessError(context, error);
    }
  });
  app.get("/api/runs/:id", async (context) => {
    try {
      return context.json(
        await host.get(context.req.param("id"), credential(context)),
      );
    } catch (error) {
      return accessError(context, error);
    }
  });
  app.post("/api/runs/:id/cancel", async (context) => {
    try {
      await host.cancel(context.req.param("id"), credential(context));
      return context.json(
        await host.get(context.req.param("id"), credential(context)),
      );
    } catch (error) {
      return accessError(context, error);
    }
  });
  app.get("/api/runs/:id/events", async (context) => {
    const id = context.req.param("id");
    try {
      await host.get(id, credential(context));
    } catch (error) {
      return accessError(context, error);
    }
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
  app.get("/api/sources/:version", async (context) => {
    if (options.imports && isUuid(context.req.param("version")))
      return context.json(
        await options.imports.version(
          credential(context),
          context.req.param("version"),
        ),
      );
    const scope = await options.access?.authorize(credential(context), "read");
    const source = sources.version(context.req.param("version"), scope);
    return source
      ? context.json(source)
      : context.json({ error: "not_found" }, 404);
  });
  return app;
}
