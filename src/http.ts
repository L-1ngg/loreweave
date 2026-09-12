import type { MaintenanceService } from "./maintenance.ts";
import { maintenanceRoutes } from "./maintenance-http.ts";
import { mcpHandler } from "./mcp.ts";
import type { ExternalKnowledge } from "./external-knowledge.ts";
import { wikiRoutes } from "./wiki-http.ts";
import type { WikiService } from "./wiki.ts";
import { IdentityService } from "./identity.ts";
import { identityRoutes } from "./identity-http.ts";
import { SourceService } from "./sources.ts";
import { sourceRoutes } from "./source-http.ts";
import { AccessService } from "./access.ts";
import { accessRoutes } from "./access-http.ts";
import { Hono } from "hono";
import { runRoutes } from "./run-http.ts";
import { credential, accessError } from "./http-common.ts";
import { isUuid } from "./http-input.ts";
import { KnowledgeHost } from "./host.ts";
import { FixtureSources } from "./development/sources.ts";
import { graphRoutes } from "./graph-http.ts";
import type { GraphService } from "./graph.ts";

/** Development-only transport. Binding and origin checks do not replace M01 auth. */
export function createApp(
  host: KnowledgeHost,
  sources: FixtureSources,
  options: {
    maintenance?: MaintenanceService;
    external?: ExternalKnowledge;
    browserOrigin?: string;
    access?: AccessService;
    imports?: SourceService;
    identities?: IdentityService;
    wiki?: WikiService;
    graph?: GraphService;
  } = {},
) {
  const app = new Hono();
  app.onError((error, context) => accessError(context, error));
  if (options.access && options.external) {
    const mcp = mcpHandler(options.access, options.external);
    app.all("/mcp", (context) => mcp(context.req.raw));
  }
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
  if (options.maintenance)
    app.route("/api", maintenanceRoutes(options.maintenance));
  if (options.wiki) app.route("/api", wikiRoutes(options.wiki));
  if (options.identities) app.route("/api", identityRoutes(options.identities));
  if (options.imports) app.route("/api", sourceRoutes(options.imports));
  if (options.graph) app.route("/api", graphRoutes(options.graph));
  app.route("/api", runRoutes(host, Boolean(options.access)));
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
