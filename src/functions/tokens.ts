import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireWeb } from "../server/access";
import { listTokens, createToken, revokeToken } from "../server/tokens";
export const getTokens = createServerFn({ method: "GET" }).handler(async () =>
  listTokens(await requireWeb()),
);
export const newToken = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().trim().min(1).max(100) }).strict())
  .handler(async ({ data }) => createToken(await requireWeb(), data.name));
export const removeToken = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .handler(async ({ data }) => revokeToken(await requireWeb(), data.id));
