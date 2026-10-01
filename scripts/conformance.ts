import { loadLocalConfiguration } from "./configuration";
import postgres from "postgres";
await loadLocalConfiguration();
const url = new URL(process.env.LOREWEAVE_DATABASE_URL!);
url.pathname = "/postgres";
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
const name = `loreweave_pageindex_conformance_${process.pid}`;
await admin.unsafe(`CREATE DATABASE "${name}"`);
url.pathname = `/${name}`;
process.env.LOREWEAVE_DATABASE_URL = url.toString();
let code = 1;
try {
  const { migrateDatabase, database } = await import("../src/server/database");
  await migrateDatabase();
  await database().client.end();
  const child = Bun.spawn(
    [
      "node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.config.ts",
    ],
    { env: process.env, stdout: "inherit", stderr: "inherit" },
  );
  code = await child.exited;
} finally {
  await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
process.exit(code);
