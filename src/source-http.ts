import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { credential } from "./access-http.ts";
import { SourceService } from "./sources.ts";
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function sourceRoutes(sources: SourceService) {
  const app = new Hono();
  app.get("/sources/inventory", async (c) => {
    const after = c.req.query("after");
    if (after && !isUuid(after)) throw new Error("invalid_input");
    return c.json(await sources.inventory(credential(c), after));
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => c.json({ error: "invalid_input" }, 413),
    }),
  );
  app.post("/attachments", async (c) => {
    const form = await c.req.formData().catch(() => {
      throw new Error("invalid_input");
    });
    const file = form.get("file"),
      projectId = form.get("projectId");
    if (
      !(file instanceof File) ||
      file.size > 1024 * 1024 ||
      (projectId !== null && !isUuid(projectId)) ||
      [...form.keys()].some((key) => !["file", "projectId"].includes(key))
    )
      throw new Error("invalid_input");
    return c.json(
      await sources.upload(credential(c), {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        ...(typeof projectId === "string" ? { projectId } : {}),
      }),
      201,
    );
  });
  app.post("/imports", async (c) => {
    const input: unknown = await c.req.json().catch(() => null);
    if (
      !input ||
      typeof input !== "object" ||
      !("attachmentId" in input) ||
      !isUuid(input.attachmentId) ||
      !("key" in input) ||
      typeof input.key !== "string" ||
      ("projectId" in input && !isUuid(input.projectId)) ||
      (("documentId" in input || "expectedPrior" in input) &&
        (!("documentId" in input) ||
          !isUuid(input.documentId) ||
          !("expectedPrior" in input) ||
          !isUuid(input.expectedPrior))) ||
      Object.keys(input).some(
        (key) =>
          ![
            "attachmentId",
            "key",
            "projectId",
            "documentId",
            "expectedPrior",
          ].includes(key),
      )
    )
      throw new Error("invalid_input");
    return c.json(
      await sources.importAttachment(
        credential(c),
        input.attachmentId,
        input.key,
        "projectId" in input ? (input.projectId as string) : undefined,
        "documentId" in input && "expectedPrior" in input
          ? {
              documentId: input.documentId as string,
              expectedPrior: input.expectedPrior as string,
            }
          : undefined,
      ),
      202,
    );
  });
  app.get("/imports", async (c) => {
    const projectId = c.req.query("projectId");
    if (projectId && !isUuid(projectId)) throw new Error("invalid_input");
    return c.json({ operations: await sources.list(credential(c), projectId) });
  });
  app.get("/imports/:id", async (c) => {
    if (!isUuid(c.req.param("id"))) throw new Error("invalid_input");
    return c.json(await sources.inspect(credential(c), c.req.param("id")));
  });
  app.get("/sources/:version/original", async (c) => {
    if (!isUuid(c.req.param("version"))) throw new Error("invalid_input");
    return new Response(
      Uint8Array.from(
        await sources.original(credential(c), c.req.param("version")),
      ).buffer,
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": "attachment; filename=source.md",
          "x-content-type-options": "nosniff",
        },
      },
    );
  });
  app.get("/sources/:version/passages/:id", async (c) => {
    if (!isUuid(c.req.param("version")) || !isUuid(c.req.param("id")))
      throw new Error("invalid_input");
    return c.json(
      await sources.resolve(
        credential(c),
        c.req.param("version"),
        c.req.param("id"),
      ),
    );
  });
  return app;
}
