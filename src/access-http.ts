import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { AccessService, grants, type Grant } from "./access.ts";

export function credential(context: Context): string {
  return getCookie(context, "loreweave_session") ?? "";
}
export function accessError(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : "unavailable";
  if (message === "unauthorized") return context.json({ error: message }, 401);
  if (message === "invalid_input") return context.json({ error: message }, 400);
  if (
    message === "version_conflict" ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505")
  )
    return context.json({ error: "version_conflict" }, 409);
  if (message === "not_found") return context.json({ error: message }, 404);
  return context.json({ error: "unavailable" }, 503);
}
export function accessRoutes(access: AccessService) {
  const app = new Hono();
  app.onError((error, context) => accessError(context, error));
  app.post("/auth/login", async (context) => {
    const input = (await context.req.json().catch(() => null)) as unknown;
    if (
      !input ||
      typeof input !== "object" ||
      !("organization" in input) ||
      typeof input.organization !== "string" ||
      !("username" in input) ||
      typeof input.username !== "string" ||
      !("password" in input) ||
      typeof input.password !== "string"
    )
      throw new Error("invalid_input");
    const login = await access.login({
      organization: input.organization,
      username: input.username,
      password: input.password,
    });
    setCookie(context, "loreweave_session", login.token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(context.req.url).protocol === "https:",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return context.json({ actor: login.actor });
  });
  app.post("/auth/logout", async (context) => {
    await access.revoke(credential(context));
    deleteCookie(context, "loreweave_session", { path: "/" });
    return context.json({ ok: true });
  });
  app.get("/auth/me", async (context) =>
    context.json({ actor: await access.identity(credential(context)) }),
  );
  app.get("/admin/members", async (context) =>
    context.json({ members: await access.members(credential(context)) }),
  );
  app.post("/admin/members", async (context) => {
    const input = await inputRecord(context);
    if (
      !Array.isArray(input.grants) ||
      input.grants.some(
        (value) =>
          typeof value !== "string" || !grants.includes(value as Grant),
      )
    )
      throw new Error("invalid_input");
    const member = await access.createMember(credential(context), {
      username: stringField(input, "username"),
      password: stringField(input, "password"),
      grants: input.grants as Grant[],
    });
    return context.json({ member }, 201);
  });
  app.post("/admin/members/:id/revoke", async (context) => {
    const id = context.req.param("id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_input");
    await access.revokeMemberSessions(credential(context), id);
    return context.json({ ok: true });
  });
  app.get("/projects", async (context) =>
    context.json({ projects: await access.projects(credential(context)) }),
  );
  app.post("/admin/projects", async (context) => {
    const input = await inputRecord(context);
    return context.json(
      {
        project: await access.createProject(
          credential(context),
          stringField(input, "name"),
        ),
      },
      201,
    );
  });
  return app;
}

async function inputRecord(context: Context): Promise<Record<string, unknown>> {
  const input = (await context.req.json().catch(() => null)) as unknown;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_input");
  return input as Record<string, unknown>;
}
function stringField(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== "string") throw new Error("invalid_input");
  return input[key];
}
