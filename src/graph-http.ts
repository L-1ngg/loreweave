import { isUuid } from "./http-input.ts";
import { Hono } from "hono";
import { credential } from "./http-common.ts";
import type { GraphService } from "./graph.ts";

export function graphRoutes(graph: GraphService) {
  const app = new Hono();
  app.get("/graph/operations/:id", async (context) => {
    const id = context.req.param("id");
    if (!isUuid(id)) throw new Error("invalid_input");
    return context.json(await graph.inspect(credential(context), id));
  });
  app.get("/graph/neighborhood", async (context) => {
    const entityId = context.req.query("entityId");
    const projectId = context.req.query("projectId");
    const predicate = context.req.query("predicate");
    const hopsRaw = context.req.query("hops");
    if (!isUuid(entityId) || (projectId && !isUuid(projectId)))
      throw new Error("invalid_input");
    const entity = entityId as string;
    const hops = hopsRaw === undefined ? undefined : Number(hopsRaw);
    if (hops !== undefined && (!Number.isInteger(hops) || hops < 1 || hops > 2))
      throw new Error("invalid_input");
    return context.json(
      await graph.neighborhood(credential(context), {
        entityId: entity,
        ...(projectId ? { projectId } : {}),
        ...(predicate ? { predicate } : {}),
        ...(hops !== undefined ? { hops } : {}),
      }),
    );
  });
  return app;
}
