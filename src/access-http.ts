import { credential, accessError } from "./http-common.ts";
import { jsonInput, inputRecord, stringField } from "./http-input.ts";
export { credential, accessError } from "./http-common.ts";
import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { AccessService, grants, type Grant } from "./access.ts";

export function accessRoutes(access: AccessService) {
  const app = new Hono();
  app.onError((error, context) => accessError(context, error));
  app.post("/auth/login", async (context) => {
    const input = await jsonInput(context);
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
  app.post("/admin/credentials", async (context) => {
    const input = await inputRecord(context);
    if (
      !Array.isArray(input.grants) ||
      input.grants.length !== 1 ||
      input.grants[0] !== "read"
    )
      throw new Error("invalid_input");
    return context.json(
      await access.issueCredential(credential(context), {
        name: stringField(input, "name"),
        grants: ["read"],
      }),
      201,
    );
  });
  app.post("/admin/credentials/:id/revoke", async (context) => {
    const id = context.req.param("id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_input");
    await access.revokeCredential(credential(context), id);
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
