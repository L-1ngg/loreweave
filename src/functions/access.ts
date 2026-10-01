import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { setResponseHeader } from "@tanstack/react-start/server";
import { login, logout, requireWeb, session } from "../server/access";

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    setResponseHeader("Cache-Control", "private, no-store");
    const actor = await session();
    return actor ? { ownerId: actor.ownerId } : null;
  },
);
export const loginOwner = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1).max(256) }).strict())
  .handler(({ data }) => login(data.password));
export const logoutOwner = createServerFn({ method: "POST" }).handler(() =>
  logout(),
);
export const workspaceMetadata = createServerFn({ method: "GET" }).handler(
  async () => {
    const actor = await requireWeb();
    return {
      ownerId: actor.ownerId,
      views: ["conversation", "documents", "settings"],
    };
  },
);
