import { resolve } from "node:path";
import { z } from "zod";

export function configuration() {
  const parsed = z
    .object({
      LOREWEAVE_DATABASE_URL: z.string().url(),
      LOREWEAVE_ARTIFACT_DIRECTORY: z.string().min(1),
      LOREWEAVE_ACCESS_PASSWORD: z.string().min(12),
      LOREWEAVE_SECRET_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
      LOREWEAVE_MODE: z.enum(["fixture", "real"]).default("real"),
    })
    .safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `configuration_missing_or_invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const e = parsed.data;
  const database = new URL(e.LOREWEAVE_DATABASE_URL).pathname.slice(1);
  if (!database.startsWith("loreweave_pageindex"))
    throw new Error(
      "database_isolation_required: use a new loreweave_pageindex database",
    );
  return {
    databaseUrl: e.LOREWEAVE_DATABASE_URL,
    artifactDirectory: resolve(e.LOREWEAVE_ARTIFACT_DIRECTORY),
    accessPassword: e.LOREWEAVE_ACCESS_PASSWORD,
    secretKey: e.LOREWEAVE_SECRET_KEY,
    mode: e.LOREWEAVE_MODE,
  };
}
