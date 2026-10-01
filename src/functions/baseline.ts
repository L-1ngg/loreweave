import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { databaseProbe, requireProbe } from "../server/baseline";

export const baselinePublic = createServerFn({ method: "GET" }).handler(() => ({
  product: "LoreWeave",
  runtime: "Bun",
  baseline: true,
}));
export const baselinePrivate = createServerFn({ method: "GET" }).handler(
  async () => {
    requireProbe(getRequest());
    return { rows: await databaseProbe() };
  },
);
