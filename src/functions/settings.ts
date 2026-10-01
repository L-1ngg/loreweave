import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireWeb } from "../server/access";
import {
  settings,
  saveConnection,
  saveRole,
  verifyRole,
} from "../server/models";
import { connectionInput, roleInput } from "../contracts/settings";

export const getSettings = createServerFn({ method: "GET" }).handler(async () =>
  settings(await requireWeb()),
);
export const putConnection = createServerFn({ method: "POST" })
  .validator(connectionInput)
  .handler(async ({ data }) => saveConnection(await requireWeb(), data));
export const putRole = createServerFn({ method: "POST" })
  .validator(roleInput)
  .handler(async ({ data }) => saveRole(await requireWeb(), data));
export const testRole = createServerFn({ method: "POST" })
  .validator(z.object({ role: z.enum(["index", "qa"]) }).strict())
  .handler(async ({ data }) => verifyRole(await requireWeb(), data.role));
