import { Hono } from "hono";
import { credential } from "./access-http.ts";
import { isUuid } from "./source-http.ts";
import type { WikiService } from "./wiki.ts";
export function wikiRoutes(wiki: WikiService) {
  const app = new Hono();
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
