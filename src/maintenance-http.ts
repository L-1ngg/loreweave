import { Hono } from "hono";
import { credential } from "./access-http.ts";
import { isUuid } from "./source-http.ts";
import type { MaintenanceService } from "./maintenance.ts";
export function maintenanceRoutes(service: MaintenanceService) {
  const app = new Hono();
  app.get("/operations/:id", async (context) => {
    const id = context.req.param("id");
    if (!isUuid(id)) throw new Error("invalid_input");
    return context.json(await service.inspect(credential(context), id));
  });
  app.post("/operations/:id/reconcile", async (context) => {
    const id = context.req.param("id");
    if (!isUuid(id)) throw new Error("invalid_input");
    return context.json(await service.reconcile(credential(context), id));
  });
  return app;
}
