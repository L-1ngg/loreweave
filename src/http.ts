import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { KnowledgeHost } from "./host.ts";
import { FixtureSources } from "./development/sources.ts";

/** Development-only transport. Binding and origin checks do not replace M01 auth. */
export function createApp(
  host: KnowledgeHost,
  sources: FixtureSources,
  options: { browserOrigin?: string } = {},
) {
  const app = new Hono();
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
    if ("complex" in input && typeof input.complex !== "boolean")
      return context.json({ error: "invalid_input" }, 400);
    try {
      return context.json(
        host.start({
          question: input.question,
          complex: "complex" in input && input.complex === true,
        }),
        202,
      );
    } catch {
      return context.json({ error: "unavailable" }, 503);
    }
  });
  app.get("/api/runs/:id", (context) => {
    try {
      return context.json(host.get(context.req.param("id")));
    } catch {
      return context.json({ error: "not_found" }, 404);
    }
  });
  app.post("/api/runs/:id/cancel", (context) => {
    try {
      host.cancel(context.req.param("id"));
      return context.json(host.get(context.req.param("id")));
    } catch {
      return context.json({ error: "not_found" }, 404);
    }
  });
  app.get("/api/runs/:id/events", (context) => {
    const id = context.req.param("id");
    try {
      host.get(id);
    } catch {
      return context.json({ error: "not_found" }, 404);
    }
    let after = Number(context.req.header("last-event-id") ?? "0");
    if (!Number.isSafeInteger(after) || after < 0)
      return context.json({ error: "invalid_input" }, 400);
    return streamSSE(context, async (stream) => {
      while (!stream.aborted) {
        for (const event of host.events(id, after)) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(event),
          });
          after = event.sequence;
        }
        if (host.get(id).settledAt) break;
        await stream.sleep(10);
      }
    });
  });
  app.get("/api/sources/:version", (context) => {
    const source = sources.version(context.req.param("version"));
    return source
      ? context.json(source)
      : context.json({ error: "not_found" }, 404);
  });
  return app;
}
