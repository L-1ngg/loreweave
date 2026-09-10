import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { credential } from "./access-http.ts";
import { isUuid } from "./source-http.ts";
import { record } from "./answer-validation.ts";
import { IdentityService, type IdentityWitness } from "./identity.ts";
export function identityRoutes(identities: IdentityService) {
  const app = new Hono();
  app.use(
    "*",
    bodyLimit({
      maxSize: 32768,
      onError: (c) => c.json({ error: "invalid_input" }, 413),
    }),
  );
  app.get("/sources/:version/identities", async (c) => {
    const version = c.req.param("version"),
      after = c.req.query("after");
    if (!isUuid(version) || (after && !isUuid(after)))
      throw new Error("invalid_input");
    return c.json(await identities.list(credential(c), version, after));
  });
  app.post("/sources/:version/identities", async (c) => {
    const version = c.req.param("version"),
      input: unknown = await c.req.json().catch(() => null);
    if (
      !isUuid(version) ||
      !record(input) ||
      !isUuid(input.passageId) ||
      typeof input.label !== "string" ||
      ("occurrence" in input && typeof input.occurrence !== "number") ||
      Object.keys(input).some(
        (key) => !["passageId", "label", "occurrence"].includes(key),
      )
    )
      throw new Error("invalid_input");
    return c.json(
      await identities.record(credential(c), {
        version,
        passageId: input.passageId,
        label: input.label,
        ...(typeof input.occurrence === "number"
          ? { occurrence: input.occurrence }
          : {}),
      }),
      201,
    );
  });
  app.get("/identities/:id", async (c) => {
    if (!isUuid(c.req.param("id"))) throw new Error("invalid_input");
    return c.json(await identities.inspect(credential(c), c.req.param("id")));
  });
  app.get("/identities/:id/history", async (c) => {
    if (!isUuid(c.req.param("id"))) throw new Error("invalid_input");
    return c.json({
      revisions: await identities.history(credential(c), c.req.param("id")),
    });
  });
  app.post("/identities/bind", async (c) => {
    const input: unknown = await c.req.json().catch(() => null);
    if (
      !record(input) ||
      typeof input.key !== "string" ||
      !isUuid(input.mentionId) ||
      !isUuid(input.targetId) ||
      !isUuid(input.expectedRevision) ||
      !Array.isArray(input.witnesses) ||
      !input.witnesses.every(
        (w) =>
          record(w) &&
          ["equivalence", "identifier"].includes(String(w.kind)) &&
          Array.isArray(w.sources) &&
          w.sources.every(
            (source) =>
              record(source) &&
              isUuid(source.version) &&
              isUuid(source.passageId) &&
              Object.keys(source).every((key) =>
                ["version", "passageId"].includes(key),
              ),
          ) &&
          Object.keys(w).every((key) => ["kind", "sources"].includes(key)),
      ) ||
      Object.keys(input).some(
        (key) =>
          ![
            "key",
            "mentionId",
            "targetId",
            "expectedRevision",
            "witnesses",
          ].includes(key),
      )
    )
      throw new Error("invalid_input");
    return c.json(
      await identities.bind(credential(c), {
        key: input.key,
        mentionId: input.mentionId,
        targetId: input.targetId,
        expectedRevision: input.expectedRevision,
        witnesses: input.witnesses as IdentityWitness[],
      }),
    );
  });
  return app;
}
