import { Hono } from "hono";
import { credential } from "./access-http.ts";
import { isUuid } from "./source-http.ts";
import type { WikiService } from "./wiki.ts";
import { record } from "./answer-validation.ts";
export function wikiRoutes(wiki: WikiService) {
  const app = new Hono();
  app.post("/wiki-restructures", async (c) => {
    const input: unknown = await c.req.json();
    if (
      !record(input) ||
      typeof input.key !== "string" ||
      !["merge", "split"].includes(String(input.kind)) ||
      typeof input.reason !== "string" ||
      !Array.isArray(input.pages) ||
      input.pages.some(
        (page) =>
          !record(page) || !isUuid(page.pageId) || !isUuid(page.version),
      )
    )
      throw new Error("invalid_input");
    return c.json(
      await wiki.restructure(credential(c), {
        key: input.key,
        kind: input.kind as "merge" | "split",
        reason: input.reason,
        pages: input.pages.map((page) => ({
          pageId: String(page.pageId),
          version: String(page.version),
        })),
      }),
    );
  });
  app.post("/wiki-edit-sets/:id/restore", async (c) => {
    const id = c.req.param("id"),
      input: unknown = await c.req.json();
    if (
      !isUuid(id) ||
      !record(input) ||
      typeof input.key !== "string" ||
      typeof input.reason !== "string"
    )
      throw new Error("invalid_input");
    return c.json(
      await wiki.restoreEditSet(credential(c), {
        key: input.key,
        editSetId: id,
        reason: input.reason,
      }),
    );
  });
  app.get("/wiki/:id/history", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) throw new Error("invalid_input");
    return c.json(await wiki.history(credential(c), id));
  });
  app.post("/wiki/:id/restore", async (c) => {
    const id = c.req.param("id"),
      input: unknown = await c.req.json();
    if (
      !isUuid(id) ||
      !record(input) ||
      typeof input.key !== "string" ||
      typeof input.reason !== "string" ||
      !isUuid(input.versionId) ||
      !isUuid(input.expectedVersion)
    )
      throw new Error("invalid_input");
    return c.json(
      await wiki.restore(credential(c), {
        key: input.key,
        pageId: id,
        versionId: input.versionId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    );
  });
  app.post("/wiki-contributions", async (c) => {
    const input: unknown = await c.req.json();
    if (
      !record(input) ||
      typeof input.key !== "string" ||
      !["fact", "guidance"].includes(String(input.kind)) ||
      typeof input.text !== "string" ||
      (input.projectId !== undefined && !isUuid(input.projectId)) ||
      (input.target !== undefined && typeof input.target !== "string")
    )
      throw new Error("invalid_input");
    return c.json(
      await wiki.contribute(credential(c), {
        key: input.key,
        kind: input.kind as "fact" | "guidance",
        text: input.text,
        ...(input.projectId ? { projectId: String(input.projectId) } : {}),
        ...(typeof input.target === "string" ? { target: input.target } : {}),
      }),
    );
  });
  app.get("/wiki-guidance", async (c) => {
    const project = c.req.query("projectId");
    if (project && !isUuid(project)) throw new Error("invalid_input");
    return c.json({ items: await wiki.guidance(credential(c), project) });
  });
  app.post("/wiki-operations/:id/repair", async (c) => {
    const id = c.req.param("id"),
      input: unknown = await c.req.json();
    if (
      !isUuid(id) ||
      !record(input) ||
      typeof input.key !== "string" ||
      typeof input.guidance !== "string"
    )
      throw new Error("invalid_input");
    return c.json({
      operationId: await wiki.repair(credential(c), {
        key: input.key,
        operationId: id,
        guidance: input.guidance,
      }),
    });
  });
  app.get("/wiki", async (c) => {
    const project = c.req.query("projectId"),
      after = c.req.query("after");
    if ((project && !isUuid(project)) || (after && !isUuid(after)))
      throw new Error("invalid_input");
    return c.json(await wiki.list(credential(c), project, after));
  });
  app.get("/wiki/:id", async (c) => {
    const id = c.req.param("id"),
      version = c.req.query("version");
    if (!isUuid(id) || (version && !isUuid(version)))
      throw new Error("invalid_input");
    return c.json(await wiki.page(credential(c), id, version));
  });
  app.get("/wiki-operations/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) throw new Error("invalid_input");
    return c.json(await wiki.inspect(credential(c), id));
  });
  return app;
}
